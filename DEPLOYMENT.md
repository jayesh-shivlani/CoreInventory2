# Deployment Guide (Render)

This project can be deployed as a single web service that serves:

- Backend API (`/api/*`)
- Frontend React app (`/` and client routes)
- SQLite database file

## Important: Render Free Tier Limitation

- Render free web services do not support attached disks.
- On free tier, SQLite will be stored in `/tmp/coreinventory.db` and can be reset on restart/redeploy.
- For persistent SQLite storage, upgrade to a paid plan and attach a disk.

## 1. Push repository to GitHub

Render deploys from Git repositories, so push this project to GitHub first.

## 2. Create a new Blueprint on Render

1. Open Render dashboard.
2. Click **New +** > **Blueprint**.
3. Connect your GitHub repo.
4. Render will detect [`render.yaml`](render.yaml).
5. Create the service.

## 3. Set production origin

After first deploy, set env var:

- `ALLOWED_ORIGINS=https://<your-render-domain>`

You can include multiple origins separated by commas.

Also ensure this env var is set so frontend build dependencies are installed during Render build:

- `NPM_CONFIG_PRODUCTION=false`

## 4. Verify deployment

Check:

- Health endpoint: `https://<your-domain>/api/health`
- App page: `https://<your-domain>/`
- Login with demo account:
  - Email: `demo@coreinventory.app`
  - Password: `demo12345`

## Notes

- Free tier DB path is `/tmp/coreinventory.db` (ephemeral).
- For persistent storage on paid plan, set `DB_PATH=/var/data/coreinventory.db` and attach a disk.
- Render build needs frontend devDependencies (TypeScript/Vite/types) to compile; `render.yaml` already uses `npm install --include=dev --prefix frontend`.
- Backend auto-initializes schema and seed user on startup.
- Frontend is built during deploy and served by backend from `frontend/dist`.
