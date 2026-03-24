# Core Inventory Backend

Backend API for Core Inventory IMS, built with Node.js + Express and PostgreSQL.

## Responsibilities

- JWT-based authentication and protected routes
- Product and location master data APIs
- Inventory operation lifecycle (Receipt, Delivery, Internal, Adjustment)
- Stock movement validation and ledger generation
- Dashboard aggregation endpoints
- Global command-search API for products, operations, and locations

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
|  |- config.js    # environment loading + runtime config checks
|  |- db.js        # DB adapter + schema bootstrap + seed
|  |- routes/
|  |  `- search.js # global command-search API
|  |- services/
|  |  `- emailService.js
|  |- utils/
|  |  `- withTimeout.js
|  `- server.js    # API routes and app bootstrap
|- scripts/        # smoke tests and RLS/role verification helpers
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
  - Local development loopback and private-network origins remain allowed automatically when `NODE_ENV` is not `production`
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

Smoke test API flows:

```bash
npm run test:smoke
```

Default base URL: `http://localhost:4000`

Health endpoint:

- `GET /api/health`

## Main API Endpoints

The list below is intentionally grouped by domain and includes the primary routes currently exposed by the backend.

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/reset-password`
- `GET /api/users/me`
- `GET /api/users/role-request-status`

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
- `POST /api/operations/:id/status`
- `POST /api/operations/:id/validate`
- `DELETE /api/operations/:id`
- `GET /api/ledger`

Locations:

- `GET /api/locations`
- `POST /api/locations`
- `DELETE /api/locations/:id`

Notifications:

- `GET /api/notifications`

Search:

- `GET /api/search`

## Authorization Notes

Admin (Admin role required):

- `GET /api/admin/role-requests`
- `POST /api/admin/role-requests/:id/approve`
- `POST /api/admin/role-requests/:id/reject`
- `GET /api/admin/users`
- `POST /api/admin/users/:id/revoke-role`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/role-audit-log`

## Demo Credentials

Use private deployment-managed credentials for judge or stakeholder access.
Do not publish live or seeded credentials in the repository.

All operational and read APIs require a valid JWT.

Manager/Admin role is required for sensitive write routes:

- `POST /api/products`
- `PUT /api/products/:id`
- `DELETE /api/products/:id`
- `POST /api/locations`
- `DELETE /api/locations/:id`
- `DELETE /api/operations/:id`

Admin role is required for all `/api/admin/*` routes.

## Environment Variables — Admin Seed

On first startup, the database is seeded with a default admin user. Configure these before deploying:

| Variable | Default | Description |
|---|---|---|
| `ADMIN_EMAIL` | `admin@example.com` | Default admin login email |
| `ADMIN_PASSWORD` | `Admin@12345` | Default admin password |
| `ADMIN_NAME` | `Admin User` | Display name for default admin |

Always override the defaults via environment variables in production.

## Production Readiness

- Set `JWT_SECRET` to a strong non-default secret.
- Ensure `DATABASE_URL` is configured.
- Startup automatically creates read-heavy indexes used by dashboard, search, operations, and ledger queries.
- Set `ALLOWED_ORIGINS` (or `CLIENT_ORIGIN`) explicitly.
- Set `EXPOSE_DEV_OTP=false`.
- Keep `STRICT_EMAIL_DOMAIN_CHECK` enabled if your DNS environment is stable.
- Change `ADMIN_EMAIL` and `ADMIN_PASSWORD` from defaults before first production startup.
- Do not commit `.env` or any secret-bearing files.
