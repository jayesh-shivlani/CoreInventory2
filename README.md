# Core Inventory IMS

A full-stack inventory management system for product cataloging, warehouse stock control, and internal logistics operations.

**Live demo:** https://coreinventory.onrender.com

## Project Snapshot

- Monorepo with independent frontend and backend workspaces
- React + TypeScript frontend (Vite)
- Node.js + Express backend API
- PostgreSQL database via Supabase
- OTP-supported authentication and role-aware user model
- Render-ready deployment configuration

## Features

- **Authentication**
	- Register, login, profile
	- Email OTP signup verification
	- OTP-assisted password reset with confirm-password validation
- **Access control**
	- Role hierarchy: Admin › Manager › Warehouse Staff
	- Admin approval workflow for new role requests
	- Admin can approve, reject, revoke roles, and delete users
	- Role-action audit log
- **Notifications**
	- Real-time in-app notification bell (polls every 8 s)
	- Role-filtered: low-stock alerts, pending approvals, operation status
- **Inventory visibility**
	- KPI dashboard with filters and contextual icons
	- Product list with stock levels and low-stock highlighting
- **Stock operations**
	- Receipts, delivery orders, internal transfers, inventory adjustments
- **Operational traceability**
	- Immutable stock ledger capturing every move
- **Master data**
	- Warehouse and location management

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
- `npm run test:smoke:api` : run automated backend API smoke tests

## CI Checks

GitHub Actions workflow: `.github/workflows/ci.yml`

- Always runs frontend lint/build and backend syntax checks on push/PR.
- Runs backend smoke tests only when `CI_DATABASE_URL` is provided as a repository secret.

## API Highlights

Auth & users:
- `POST /api/auth/register` — OTP signup request / verify
- `POST /api/auth/login`
- `POST /api/auth/reset-password`
- `GET /api/users/me`
- `GET /api/users/role-request-status`
- `POST /api/users/role-requests`

Dashboard:
- `GET /api/dashboard/kpis`
- `GET /api/dashboard/filters`

Products & inventory:
- `GET /api/products`
- `POST /api/products`
- `PUT /api/products/:id`
- `GET /api/products/:id/stock`

Operations & ledger:
- `GET /api/operations`
- `POST /api/operations`
- `POST /api/operations/:id/status`
- `POST /api/operations/:id/validate`
- `DELETE /api/operations/:id`
- `GET /api/ledger`

Locations:
- `GET /api/locations`
- `POST /api/locations`
- `DELETE /api/locations/:id`

Admin (Admin role required):
- `GET /api/admin/role-requests`
- `POST /api/admin/role-requests/:id/approve`
- `POST /api/admin/role-requests/:id/reject`
- `GET /api/admin/users`
- `POST /api/admin/users/:id/upgrade-role`
- `POST /api/admin/users/:id/revoke-role`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/role-audit-log`

Notifications:
- `GET /api/notifications`

## Deployment

- Render configuration is provided in `render.yaml`
- Deployment runbook is in `DEPLOYMENT.md`

## Production Readiness

- Set strong non-default values for `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
- Keep `EXPOSE_DEV_OTP=false` in production.
- Configure `ALLOWED_ORIGINS` explicitly for your deployed frontend origin.
- Do not commit `.env` files or secret-bearing files.

## Demo Access

- Email: `demo@coreinventory.app`
- Password: `demo12345`
