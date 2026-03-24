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
- Notifications bell (role-aware alerts, dismiss, clear-all)
- Global command search for products, operations, locations, and quick actions
- Admin tools (approve/reject role requests, revoke roles, delete users)
- Role-action audit history

## Stack

- React 19
- TypeScript
- React Router
- Vite 8
- ESLint 9

## Source Structure

```text
frontend/
|- src/
|  |- App.tsx                # main routed UI shell and pages
|  |- components/
|  |  |- layout/             # app shell and top-bar search
|  |  `- PageLoadingState.tsx
|  |- main.tsx               # React bootstrap
|  |- index.css              # global styles
|  |- config/
|  |  `- constants.ts        # app-wide constants and env-derived values
|  |- hooks/
|  |  |- useDebouncedValue.ts
|  |  `- useLivePolling.ts
|  |- pages/                 # route-level screens
|  |- utils/
|  |  |- downloads.ts        # authenticated file downloads
|  |  `- helpers.ts          # API client + formatting helpers
|  `- types/
|     `- models.ts           # shared TypeScript models
|- public/
|  `- odoo.png               # branding image used on auth screen
|- index.html
`- README.md
```

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
- Top-bar search supports `/` as a keyboard shortcut
- Route-level lazy loading keeps the initial bundle smaller and faster to load

## Production Notes

- Set `VITE_API_URL` explicitly for deployed environments.
- Keep API and app origins aligned with backend `ALLOWED_ORIGINS`.
- Do not commit `.env` or any secret-bearing files.
