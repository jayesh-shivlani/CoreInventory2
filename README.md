# Core Inventory IMS

Core Inventory IMS is a full-stack inventory management system for product cataloging, warehouse stock control, and internal logistics operations.

Live application: https://coreinventory.onrender.com

## Project Snapshot

- Monorepo with independent frontend and backend workspaces
- React + TypeScript frontend (Vite)
- Node.js + Express backend API
- PostgreSQL database via `DATABASE_URL` (including Supabase)
- OTP-supported authentication and role-aware user model
- Render-ready deployment configuration

## Features

- Authentication
	- Register, login, profile fetch
	- OTP-assisted password reset
- Inventory visibility
	- KPI dashboard with filters
	- Product list with stock and low-stock logic
- Stock operations
	- Receipts
	- Delivery orders
	- Internal transfers
	- Inventory adjustments
- Operational traceability
	- Immutable stock ledger (move history)
- Master data
	- Warehouse/location management

## Repository Structure

```text
CoreInventory2/
|- backend/        # Express API, DB schema/bootstrap, auth and business rules
|- frontend/       # React app (Vite + TypeScript)
|- Docs/           # Product and requirement documentation
|- DEPLOYMENT.md   # Deployment guide
|- render.yaml     # Render blueprint/service definition
|- package.json    # Root orchestration scripts
`- README.md
```

See also: `Docs/README.md` for an index of specification documents.

Contribution guidelines: `CONTRIBUTING.md`.

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- PostgreSQL instance with a valid connection string

### 1) Install dependencies

From repository root:

```bash
npm install
npm run install:all
```

### 2) Configure environment variables

Backend:

```bash
copy backend\\.env.example backend\\.env
```

Set `DATABASE_URL` in `backend/.env`.

Frontend (optional):

```bash
copy frontend\\.env.example frontend\\.env
```

### 3) Run locally

From repository root:

```bash
npm run dev
```

Local endpoints:

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000/api
- Health check: http://localhost:4000/api/health

Run services independently if needed:

```bash
npm run dev:backend
npm run dev:frontend
```

## Root Scripts

- `npm run dev` : run backend + frontend concurrently
- `npm run dev:backend` : run backend only
- `npm run dev:frontend` : run frontend only
- `npm run install:all` : install backend and frontend dependencies

## API Highlights

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/reset-password`
- `GET /api/users/me`
- `GET /api/dashboard/kpis`
- `GET /api/dashboard/filters`
- `GET /api/products`
- `POST /api/products`
- `PUT /api/products/:id`
- `GET /api/operations`
- `POST /api/operations`
- `POST /api/operations/:id/validate`
- `GET /api/ledger`
- `GET /api/locations`

## Deployment

- Render configuration is provided in `render.yaml`
- Deployment runbook is in `DEPLOYMENT.md`

## Demo Access

- Email: `demo@coreinventory.app`
- Password: `demo12345`

## Notes

- This repository is prepared for technical review and product demonstration workflows.
- If publishing publicly, ensure no production secrets are committed.
