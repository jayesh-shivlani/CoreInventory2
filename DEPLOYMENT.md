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
  - For a single-site deployment, set this to your exact live app origin, for example `https://yourdomain.com`
- `JWT_SECRET`: long random secret
  - The blueprint can generate this automatically, but keep the generated value and do not replace it with a placeholder

Admin seed (set before first deploy — these seed the default admin account):

- `ADMIN_EMAIL`: admin login email (default: `admin@example.com`)
- `ADMIN_PASSWORD`: admin password (default: `Admin@12345`) — **change this in production**
- `ADMIN_NAME`: admin display name (default: `Admin User`)

Important:

- The first production deployment should use final admin credentials you actually intend to keep.
- Do not publish admin, judge, or demo credentials in the repository.
- If you share reviewer access, create a dedicated low-risk account and share it privately.

Auto-provisioned in blueprint:

- `NODE_ENV=production`
- `NPM_CONFIG_PRODUCTION=false`
- `JWT_SECRET` (generated)
- `FRONTEND_DIST_PATH=../frontend/dist`

Email/OTP variables (Brevo):

- `BREVO_API_KEY` (required for email delivery)
- `FROM_EMAIL` (verified sender email)
- `EMAIL_TIMEOUT_MS` (default `15000`)
- `SIGNUP_OTP_TTL_MINUTES`
- `RESET_OTP_TTL_MINUTES`

Notes:

- Verify your sender identity in Brevo before production use.
- Keep `EXPOSE_DEV_OTP=false` in production.
- Keep `STRICT_EMAIL_DOMAIN_CHECK` enabled if your DNS/mail environment is stable.
- Do not set `VITE_API_URL` for the bundled frontend unless you intentionally host the API on a different origin.

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
npm run build
```

Run `npm run test:smoke:api` only when `backend/.env` is configured with a working PostgreSQL database.

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

## GitHub Launch Checklist

Before making the repository public:

1. Confirm `.env` files are not tracked:
   - `git ls-files backend/.env frontend/.env`
2. Confirm working tree is clean and only intended files will be pushed:
   - `git status`
3. Rotate any previously used demo or shared passwords if they ever appeared in commits, screenshots, or chat.
4. Verify public docs do not contain live credentials, OTPs, or secret keys.
5. Push from a reviewed branch and keep GitHub Actions green.

## Render Launch Checklist

1. Create or attach a PostgreSQL database and set `DATABASE_URL`.
2. Set `ALLOWED_ORIGINS` to the exact production frontend origin.
3. Set final values for:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `ADMIN_NAME`
   - `FROM_EMAIL`
   - `BREVO_API_KEY`
4. Deploy the service.
5. Open `/api/health` and confirm `status: ok`.
6. Log in with the seeded admin account.
7. Create one product, one receipt, and validate it.
8. Confirm stock increases, move history records the change, and global search works.
9. Verify OTP email flow from the live site.
10. If reviewer access is needed, create a separate non-admin account and share it privately.

## Post-Deploy Smoke Checklist

- Login works with the seeded admin or your private reviewer account.
- Dashboard loads KPIs and filters.
- Product CRUD works based on role permissions.
- Operation create/validate updates stock and ledger.
- Signup OTP and reset OTP flows function as expected.
- CORS allows only the intended production origin.
