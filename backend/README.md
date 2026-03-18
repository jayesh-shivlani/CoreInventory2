# Core Inventory Backend

Backend API for Core Inventory IMS, built with Node.js + Express and PostgreSQL.

## Responsibilities

- JWT-based authentication and protected routes
- Product and location master data APIs
- Inventory operation lifecycle (Receipt, Delivery, Internal, Adjustment)
- Stock movement validation and ledger generation
- Dashboard aggregation endpoints

## Tech Stack

- Runtime: Node.js
- Framework: Express
- Database: PostgreSQL (`pg`)
- Auth: `jsonwebtoken`, `bcryptjs`
- Email OTP: Brevo API

## Project Layout

```text
backend/
|- src/
|  |- auth.js      # token signing and auth middleware
|  |- db.js        # DB adapter + schema bootstrap + seed
|  `- server.js    # API routes and app bootstrap
|- data/           # reserved for local data assets if needed
|- .env.example
|- package.json
`- README.md
```

## Environment Variables

Copy and configure:

```bash
copy .env.example .env
```

Required:

- `DATABASE_URL` : PostgreSQL connection string

Important optional:

- `PORT` : server port (default `4000`)
- `JWT_SECRET` : JWT signing secret
- `ALLOWED_ORIGINS` : comma-separated list of allowed browser origins
- `BREVO_API_KEY` : enable OTP email delivery
- `FROM_EMAIL` : sender identity for OTP emails
- `EMAIL_TIMEOUT_MS` : outbound email timeout in milliseconds (default `15000`)
- `FRONTEND_DIST_PATH` : static frontend path for production serving
- `SIGNUP_OTP_TTL_MINUTES` : signup OTP validity window (default `10`)
- `RESET_OTP_TTL_MINUTES` : reset OTP validity window (default `10`)

## Run Locally

```bash
cd backend
npm install
npm run dev
```

Default base URL: `http://localhost:4000`

Health endpoint:

- `GET /api/health`

## Main API Endpoints

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/reset-password`
- `GET /api/users/me`

Dashboard:

- `GET /api/dashboard/kpis`
- `GET /api/dashboard/filters`

Products:

- `GET /api/products`
- `GET /api/products/filter-options`
- `POST /api/products`
- `PUT /api/products/:id`
- `GET /api/products/:id`
- `GET /api/products/:id/stock`

Operations and ledger:

- `GET /api/operations`
- `POST /api/operations`
- `POST /api/operations/:id/validate`
- `GET /api/ledger`

Locations:

- `GET /api/locations`
- `POST /api/locations`

## Authorization Notes

Notifications:

- `GET /api/notifications` — role-filtered: low-stock, pending approvals, operation status

Admin (Admin role required):

- `GET /api/admin/role-requests`
- `POST /api/admin/role-requests/:id/approve`
- `POST /api/admin/role-requests/:id/reject`
- `POST /api/admin/role-requests/:id/revoke`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/role-audit-log`

## Authorization Notes

- All operational and read APIs require a valid JWT.
- Manager/Admin role is required for sensitive write routes:
	- `POST /api/products`
	- `PUT /api/products/:id`
	- `DELETE /api/products/:id`
	- `POST /api/locations`
	- `DELETE /api/locations/:id`
	- `DELETE /api/operations/:id`

## Demo Credentials

- Email: `demo@coreinventory.app`
- Password: `demo12345`

- All operational and read APIs require a valid JWT.
- Manager/Admin role is required for sensitive write routes:
	- `POST /api/products`
	- `PUT /api/products/:id`
	- `DELETE /api/products/:id`
	- `POST /api/locations`
	- `DELETE /api/locations/:id`
	- `DELETE /api/operations/:id`
- Admin role is required for all `/api/admin/*` routes.

## Environment Variables — Admin Seed

On first startup, the database is seeded with a default admin user. Configure these before deploying:

| Variable | Default | Description |
|---|---|---|
| `ADMIN_EMAIL` | `admin@example.com` | Default admin login email |
| `ADMIN_PASSWORD` | `Admin@12345` | Default admin password |
| `ADMIN_NAME` | `Admin User` | Display name for default admin |

Always override the defaults via environment variables in production.
