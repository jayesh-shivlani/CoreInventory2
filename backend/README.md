# Core Inventory Backend

Express + SQLite backend for Core Inventory IMS.

## Features

- JWT authentication (register, login, reset password with OTP)
- Dashboard KPI aggregation
- Product management with SKU uniqueness validation
- Warehouse/location management
- Operations creation + validate business logic in SQL transactions
- Immutable stock ledger records

## Setup

1. Open terminal in backend folder
2. Install dependencies
3. Copy `.env.example` to `.env` (optional)
4. Start server

```bash
cd backend
npm install
npm run dev
```

Server default: `http://localhost:4000`

## Demo Login

- Email: `demo@coreinventory.app`
- Password: `demo12345`

## Main Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/reset-password`
- `GET /api/users/me`
- `GET /api/dashboard/kpis`
- `GET /api/products`
- `POST /api/products`
- `GET /api/products/:id/stock`
- `GET /api/operations`
- `POST /api/operations`
- `POST /api/operations/:id/validate`
- `GET /api/ledger`
- `GET /api/locations`
- `POST /api/locations`
