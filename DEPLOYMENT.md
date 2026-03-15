# Deployment Guide

This project is configured for Render deployment using [render.yaml](render.yaml).

## Services

- Web service name: `coreinventory`
- Runtime: Node.js
- Region/plan: Oregon / Free (default in blueprint)
- Backend serves frontend static build in production

## Required Environment Variables

Set these in Render for the web service:

- `DATABASE_URL`: PostgreSQL connection string
- `ALLOWED_ORIGINS`: comma-separated frontend origins (for CORS)

Admin seed (set before first deploy — these seed the default admin account):

- `ADMIN_EMAIL`: admin login email (default: `admin@example.com`)
- `ADMIN_PASSWORD`: admin password (default: `Admin@12345`) — **change this in production**
- `ADMIN_NAME`: admin display name (default: `Admin User`)

Auto-provisioned in blueprint:

- `NODE_ENV=production`
- `NPM_CONFIG_PRODUCTION=false`
- `JWT_SECRET` (generated)
- `FRONTEND_DIST_PATH=../frontend/dist`

Email/OTP variables (Gmail SMTP):

- `SMTP_HOST` (use `smtp.gmail.com`)
- `SMTP_PORT` (use `587`)
- `SMTP_USER` (your Gmail address)
- `SMTP_PASS` (Gmail app password)
- `FROM_EMAIL` (typically same as `SMTP_USER`)
- `SMTP_TIMEOUT_MS` (default `15000`)
- `SMTP_MAX_ATTEMPTS` (default `2`)
- `SIGNUP_OTP_TTL_MINUTES`
- `RESET_OTP_TTL_MINUTES`

Notes:

- Enable Google 2-Step Verification, then generate and use an App Password for `SMTP_PASS`.
- Regular Gmail account password will not work for SMTP.

## Build and Start

Render blueprint commands are defined in [render.yaml](render.yaml):

- Build:
  - `npm install --prefix backend`
  - `npm install --include=dev --prefix frontend`
  - `npm run build --prefix frontend`
- Start:
  - `npm run start --prefix backend`

## Local Pre-Deploy Checks

From repository root:

```bash
npm install
npm run install:all
npm run lint
npm run test:smoke:api
npm run build
```

## Manual Deploy Steps (without blueprint)

1. Create a new Render Web Service linked to this repository.
2. Set build command:
   `npm install --prefix backend && npm install --include=dev --prefix frontend && npm run build --prefix frontend`
3. Set start command:
   `npm run start --prefix backend`
4. Add required environment variables listed above.
5. Deploy and verify:
   - `/api/health` returns `status: ok`
   - frontend loads and can log in

## Post-Deploy Smoke Checklist

- Login works with demo user or seeded user.
- Dashboard loads KPIs and filters.
- Product CRUD works (based on role permissions).
- Operation create/validate updates stock and ledger.
- Signup OTP and reset OTP flows function as expected.
