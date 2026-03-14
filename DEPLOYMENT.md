# Deployment Guide (Render)

This project can be deployed as a single web service that serves:

- Backend API (`/api/*`)
- Frontend React app (`/` and client routes)
- SQLite database persisted on a Render Disk

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

## 4. Verify deployment

Check:

- Health endpoint: `https://<your-domain>/api/health`
- App page: `https://<your-domain>/`
- Login with demo account:
  - Email: `demo@coreinventory.app`
  - Password: `demo12345`

## Notes

- Database file is persisted at `/var/data/coreinventory.db` via Render Disk.
- Backend auto-initializes schema and seed user on startup.
- Frontend is built during deploy and served by backend from `frontend/dist`.
