## Backend Requirement Document: Core Inventory IMS

### 1. Architectural Overview & Constraints

* **Database:** A relational database (PostgreSQL or SQLite) running locally to meet the "offline/local solutions" and "local database" hackathon criteria.
* **Framework:** A modern REST API framework (e.g., Node.js/Express, Python/FastAPI, or Java/Spring Boot) to handle dynamic data and avoid static JSON files.
* **Validation:** Strict backend validation on all endpoints to prevent data corruption (e.g., preventing negative stock levels during deliveries).

### 2. Database Schema (Data Models)

To support multi-warehouse operations and a centralized ledger, the database needs the following core tables:

* **`Users`**: Stores authentication and role data.
* Fields: `id`, `name`, `email`, `password_hash`, `role` (Manager or Warehouse Staff) , `otp_code` (for password resets).




* 
**`Locations` (Warehouses)**: Defines physical spaces.


* Fields: `id`, `name` (e.g., Main Store, Production Rack), `type` (Vendor Location, Internal Location, Customer Location).




* 
**`Products`**: Master catalog of items.


* Fields: `id`, `name`, `sku` (unique) , `category_id` , `unit_of_measure` , `reorder_minimum` (for low stock alerts).




* 
**`Stock_Quants` (Current Stock)**: Tracks how much of a product is currently sitting in a specific location.


* Fields: `id`, `product_id`, `location_id`, `quantity`.


* 
**`Operations` (Documents)**: Headers for transactions (Receipts, Deliveries, Transfers, Adjustments).


* Fields: `id`, `reference_number`, `type` (Receipt, Delivery, Internal, Adjustment) , `status` (Draft, Waiting, Ready, Done, Canceled), `source_location_id`, `destination_location_id`, `created_at`.




* **`Operation_Lines`**: The specific items and quantities inside an Operation.
* Fields: `id`, `operation_id`, `product_id`, `requested_quantity`, `done_quantity`.


* 
**`Stock_Ledger` (Move History)**: An immutable log of every single stock movement.


* Fields: `id`, `product_id`, `from_location_id`, `to_location_id`, `quantity`, `operation_id`, `timestamp`.



### 3. Core REST API Endpoints

**A. Authentication APIs**

* 
`POST /api/auth/register` - Creates a new user.


* 
`POST /api/auth/login` - Authenticates user and returns a JWT/session token.


* 
`POST /api/auth/reset-password` - Handles OTP generation and validation for password resets.



**B. Dashboard APIs**

* 
`GET /api/dashboard/kpis` - Aggregates dynamic data to return: Total Products in Stock, Low/Out of Stock Items, Pending Receipts, Pending Deliveries, and Scheduled Internal Transfers.


* 
`GET /api/dashboard/filters` - Returns data filtered by document type, status, warehouse, or category.



**C. Product APIs**

* 
`GET /api/products` - Lists all products, supporting search by SKU and smart filters.


* 
`POST /api/products` - Creates a new product, validating required fields like Name, SKU, and UoM.


* 
`GET /api/products/{id}/stock` - Returns current stock availability per location for a specific product.



**D. Operations APIs**

* `POST /api/operations` - Creates a new Draft operation (Receipt, Delivery, Transfer, or Adjustment).
* `POST /api/operations/{id}/validate` - **(CRITICAL ENDPOINT)** Triggers the business logic to finalize the operation and move stock.

### 4. Core Business Logic (The "Validate" Action)

The `Validate` endpoint is the brain of the IMS. When an operation is validated, the backend must execute the following logic within a **Database Transaction** (to ensure data integrity):

1. **Receipts (Incoming):** Look up the `destination_location_id`. Increase the `Stock_Quants` for the products by the received amount. Write a record to the `Stock_Ledger` (From: Vendor Location -> To: Internal Location).


2. **Delivery Orders (Outgoing):** Validate that the `source_location_id` has enough stock. If yes, decrease the `Stock_Quants`. Write a record to the `Stock_Ledger` (From: Internal Location -> To: Customer Location).


3. 
**Internal Transfers:** Decrease stock in the `source_location_id` and increase stock in the `destination_location_id`. The total company stock remains unchanged. Write to the `Stock_Ledger`.


4. **Stock Adjustments:** Compare the entered physical count with the current `Stock_Quants`. Calculate the difference. Apply the difference (positive or negative) to auto-update the system. Write the adjustment to the `Stock_Ledger`.



### 5. Backend Validation Rules (Must-Haves)

* **SKU Uniqueness:** The database must reject any attempt to create a product with an existing SKU.
* **Positive Quantities:** Deliveries and Internal Transfers cannot be validated if the requested quantity exceeds the currently available `Stock_Quant`. The backend must throw a `400 Bad Request` error.
* **Ledger Immutability:** API endpoints should not exist for updating or deleting records in the `Stock_Ledger`. Once a move is done, it is permanent. Mistakes must be fixed via a new "Stock Adjustment".



---