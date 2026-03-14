### Flow 1: User Authentication

1. The user accesses the app and lands on the Login/Signup page.


2. The user enters credentials or initiates an OTP-based password reset if needed.


3. Upon successful login, the system redirects the user to the Inventory Dashboard.



### Flow 2: Dashboard Interface

1. The system loads the landing page showing a snapshot of inventory operations.


2. The user views Dashboard KPIs: Total Products in Stock, Low Stock / Out of Stock Items, Pending Receipts, Pending Deliveries, and Internal Transfers Scheduled.


3. The user interacts with dynamic filters to narrow down data by document type, status, warehouse/location, or product category.


4. The user uses the Left Sidebar to navigate to specific modules: Products, Operations, Settings, or Profile Menu.



### Flow 3: Product Management

1. The user navigates to the "Products" module.


2. The user chooses to create or update a product.


3. The user inputs core product data: Name, SKU / Code, Category, Unit of Measure, and Initial stock (optional).


4. The system saves the product, allowing it to be used in operations and tracked via SKU search and smart filters.



### Flow 4: Operations - Receipts (Incoming Goods)

1. The user navigates to "Receipts" when items arrive from vendors.


2. The user creates a new receipt and adds the supplier and products.


3. The user inputs the exact quantities received.


4. The user clicks validate.


5. The system automatically increases the stock for those items and logs the transaction in the Stock Ledger.



### Flow 5: Operations - Delivery Orders (Outgoing Goods)

1. The user navigates to "Delivery Orders" when stock needs to leave the warehouse for customer shipment.


2. The user picks the items and packs them.


3. The user clicks validate.


4. The system automatically decreases the stock and logs the transaction in the Stock Ledger.



### Flow 6: Operations - Internal Transfers

1. The user selects "Internal Transfers" to move stock inside the company.


2. The user selects the source and destination (e.g., Main Warehouse to Production Floor, or Warehouse 1 to Warehouse 2).


3. The system executes the transfer; total stock remains unchanged, but the new location is updated.


4. The system logs the movement in the ledger.



### Flow 7: Operations - Stock Adjustments

1. The user navigates to "Inventory Adjustment" to fix mismatches between recorded stock and a physical count.


2. The user selects the specific product and location.


3. The user enters the newly counted quantity.


4. The system auto-updates the recorded stock to match the physical count and logs the adjustment in the Stock Ledger.



---