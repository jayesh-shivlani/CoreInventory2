# Core Inventory IMS Frontend

Frontend for the Core Inventory Management System built with React + TypeScript + Vite.

## Included Modules

- Authentication: Login, Sign Up, OTP password reset flow
- Dashboard: KPI cards with dynamic filters
- Products: Product create form and list table with SKU search
- Operations: Receipts, Delivery Orders, Internal Transfers, Stock Adjustments
- Move History: Read-only stock ledger table
- Settings: Warehouse/location management
- Profile: My Profile view and sidebar logout

## API Configuration

The app reads API base from `VITE_API_URL`.

- Default behavior: if `VITE_API_URL` is not set, frontend calls `/api`
- Example `.env` file:

```bash
VITE_API_URL=http://localhost:4000/api
```

## Run Locally

```bash
cd frontend
npm install
npm run dev
```

## Production Build

```bash
cd frontend
npm run build
```

## Notes

- Authentication token is stored in localStorage key `ims-auth-token`
- In development mode only, login screen includes a quick access button for UI testing without backend auth
