## Technical Requirements Document (TRD): Core Inventory IMS

### 1. System Overview

The objective is to build a modular Inventory Management System (IMS) that digitizes and streamlines stock-related operations. The system will replace manual registers and Excel sheets with a centralized, real-time, and easy-to-use application. The architecture must prioritize dynamic data, robust input validation, and be capable of running via a local database to satisfy the hackathon's "nice-to-have" offline/local planning constraint.

### 2. Proposed Technology Stack

To meet the requirement of designing backend APIs, setting up a local database, and creating a responsive UI, the following stack is recommended:

* **Frontend:** React.js, Vue.js, or Next.js (ensures a responsive and clean UI, satisfying the "Must have" design constraint). Tailwind CSS for consistent styling.
* **Backend:** Node.js (Express/NestJS) or Python (FastAPI/Django) to design robust backend APIs.
* **Database:** SQLite or a locally hosted instance of PostgreSQL to meet the requirement for a local database and offline-capable planning.
* **Version Control:** Git (GitHub/GitLab) is mandatory. The repository must show commits from multiple team members to meet the specific collaboration constraint.

### 3. System Architecture & Flow

The application will follow a standard Client-Server architecture:

* **Client (Frontend):** Handles user interactions, robust input validation (e.g., preventing negative stock inputs unless adjusting), and dynamic data rendering. Static JSON is strictly prohibited for the final build.
* **Server (Backend):** Exposes RESTful APIs. It processes business logic (e.g., automatically increasing stock on validation and decreasing stock on delivery ).


* 
**Database:** Maintains the state of Users, Products, Locations, Operations, and the Stock Ledger.



### 4. Security & Authentication

* 
**User Management:** The system requires users to sign up and log in.


* 
**Password Reset:** Must implement an OTP-based password reset mechanism.


* 
**Authorization:** Upon successful authentication, users are redirected to the Inventory Dashboard. Basic role-based access control (RBAC) should distinguish between Inventory Managers and Warehouse Staff.



### 5. Core Data Entities & Validations

To ensure real-time and dynamic data sources, the database schema must support:

* 
**Products:** Must capture Name, SKU / Code, Category, and Unit of Measure. *Validation constraint: SKU must be unique.*


* 
**Stock Ledger:** Every movement (receipt, delivery, transfer, adjustment) must be logged immutably in the ledger.


* 
**Dynamic Dashboard Data:** The backend must dynamically aggregate data to display KPIs such as Total Products in Stock, Pending Receipts, and Pending Deliveries.



### 6. Technical Implementation of Operations

The core logic resides in how operations affect the database upon validation:

* 
**Receipts:** When validated, the system must execute an SQL `UPDATE` to increase stock automatically.


* 
**Delivery Orders:** When validated, the system must execute an SQL `UPDATE` to decrease stock automatically. *Validation constraint: Check if requested stock is available before processing.*


* 
**Internal Transfers:** The system must update the item's location without changing the total overall stock quantity.


* 
**Stock Adjustments:** The system must calculate the delta between the recorded stock and the user-entered physical count , auto-update the system, and log the adjustment.



### 7. Version Control & Development Workflow (Mandatory)

* **Git Workflow:** Since one member managing the repo is not enough, the team must use feature branching (e.g., `feature/auth`, `feature/receipts`).
* **AI Code Usage:** As per the hackathon rules, any AI-generated code snippets must be thoroughly understood and adapted to the specific architecture. Blind copy-pasting is prohibited.

---