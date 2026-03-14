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
- Email OTP: `resend` (optional)

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
- `RESEND_API_KEY` : enable OTP email delivery
- `FROM_EMAIL` : sender identity for OTP emails
- `FRONTEND_DIST_PATH` : static frontend path for production serving

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

## Demo Credentials

- Email: `demo@coreinventory.app`
- Password: `demo12345`
