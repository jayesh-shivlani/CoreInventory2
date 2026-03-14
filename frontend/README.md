# Core Inventory Frontend

React + TypeScript frontend for Core Inventory IMS.

## Features

- Authentication flows
	- Login
	- Sign up
	- OTP-based password reset
- Operational dashboard with KPI filters
- Product catalog and inventory views
- Operation management
	- Receipts
	- Deliveries
	- Internal transfers
	- Adjustments
- Move history (stock ledger)
- Warehouse/location settings
- User profile and session handling

## Stack

- React 19
- TypeScript
- React Router
- Vite 8
- ESLint 9

## Environment Configuration

The app reads API base URL from `VITE_API_URL`.

- If `VITE_API_URL` is omitted, requests go to `/api`
- In local development, Vite proxy forwards `/api` to `http://127.0.0.1:4000`

Create local env file:

```bash
copy .env.example .env
```

Example value:

```bash
VITE_API_URL=http://localhost:4000/api
```

## Run Locally

```bash
cd frontend
npm install
npm run dev
```

Default dev URL: `http://localhost:5173`

## Scripts

- `npm run dev` : start Vite dev server
- `npm run build` : TypeScript build + production bundle
- `npm run preview` : preview production build locally
- `npm run lint` : run ESLint

## Production Build

```bash
npm run build
```

Build output directory: `dist/`

## Notes

- Auth token key in local storage: `ims-auth-token`
- UI development mode includes helper behavior for faster testing workflows
