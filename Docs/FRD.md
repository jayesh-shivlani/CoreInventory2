## Frontend Requirement Document: Core Inventory IMS

### 1. UI/UX & Design Guidelines

To meet the hackathon's strict UI requirements, the frontend must adhere to the following principles:

* **Responsiveness:** The app must be fully responsive across desktop and tablet views, as warehouse staff may use tablets on the floor.
* **Consistency:** Maintain a consistent color scheme, typography, and layout across all modules.
* **Navigation & Layout:** Use intuitive navigation with proper menu placement and spacing. The layout should feature a persistent Left Sidebar for main navigation and a main content area for data tables and forms.


* **Data Presentation:** Avoid static JSON for the final build; all tables and dashboards must render dynamic data fetched from your APIs.
* **Feedback:** Provide clear visual feedback (toast notifications, loading spinners) when users validate operations or submit forms.

### 2. Core Layout & Navigation

Based on the required navigation structure, the main layout should include:

* 
**Left Sidebar Navigation:** * Products 


* Operations (Receipts, Delivery Orders, Inventory Adjustment, Move History) 


* Dashboard 


* Settings (Warehouse) 


* Profile Menu (My Profile, Logout) 




* **Top Bar / Breadcrumbs:** Display current page context (e.g., *Operations > Receipts > New Receipt*) as seen in the mockup structure.

### 3. Screen Requirements

**A. Authentication Screen**

* 
**Login/Signup Form:** Clean interface for users to sign up or log in.


* 
**Password Reset:** Include an OTP-based password reset flow.


* 
**Routing:** Successfully logging in must redirect the user directly to the Inventory Dashboard.



**B. Dashboard (Landing Page)**

* **KPI Cards:** Top row of visual metric cards showing:
* Total Products in Stock 


* Low Stock / Out of Stock Items 


* Pending Receipts 


* Pending Deliveries 


* Internal Transfers Scheduled 




* **Dynamic Filters:** A section to filter the dashboard data by:
* Document type (Receipts / Delivery / Internal / Adjustments) 


* Status (Draft, Waiting, Ready, Done, Canceled) 


* Warehouse or location 


* Product category 





**C. Products Module**

* 
**List View:** A data table displaying all products, stock availability per location, and categories. Must include a SKU search bar and smart filters.


* **Form View (Create/Update):** A form to input:
* Name 


* SKU / Code 


* Category 


* Unit of Measure 


* Initial stock (optional) 


* Reordering rules 





**D. Operations Modules (Receipts, Deliveries, Transfers, Adjustments)**
Each operation type requires two main views:

* **List View:** A table showing all documents for that operation type (e.g., all Delivery Orders), sortable by status and date.
* **Form View / Document View:**
* 
**Receipts:** Form to add a supplier, select products, input received quantities, and a "Validate" button to finalize the intake.


* 
**Delivery Orders:** Form to pick items, pack items, and a "Validate" button to finalize outgoing shipment.


* 
**Internal Transfers:** Form to select source location (e.g., Main Warehouse) and destination location (e.g., Production Floor), select products, and validate.


* 
**Stock Adjustments:** Form to select a product and location, input the newly counted physical quantity, and auto-update the system.





**E. Move History (Stock Ledger)**

* 
**List View Only:** A read-only, chronological data table logging every single movement. Columns should include Date, Product, From Location, To Location, Quantity, and the related Document Reference.



### 4. Frontend Validation Requirements (Must-Have)

Odoo explicitly requested robust user input validation. The frontend must implement:

* **Required Fields:** Prevent form submission if critical fields (like SKU, Product Name, or Location) are empty.
* **Quantity Checks:** * Prevent entering negative numbers in Receipts or Deliveries.
* For Deliveries, optionally show an inline warning if the requested quantity exceeds the known available stock.


* **Type Checking:** Ensure numeric fields (like quantities) only accept numbers.

---