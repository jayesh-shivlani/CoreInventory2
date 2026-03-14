# Core Inventory IMS

Core Inventory IMS is a full-stack inventory management system for handling products, warehouse stock, and operational movements in one place.

Live Application: https://coreinventory.onrender.com

## Overview

This project includes:

- A React + TypeScript frontend for day-to-day inventory operations
- A Node.js + Express backend API with authentication and business rules
- A SQLite database for product, stock, and movement tracking

## Key Features

- Authentication with signup, login, and OTP-based password reset
- Inventory dashboard with KPI cards and dynamic filters
- Product management with SKU uniqueness and update support
- Multi-location stock tracking
- Operations management:
	- Receipts
	- Delivery Orders
	- Internal Transfers
	- Stock Adjustments
- Stock ledger (move history) with immutable transaction records

## Tech Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js, Express
- Database: SQLite
- Deployment: Render

## Repository Structure

- backend: API server and database logic
- frontend: web application
- Docs: product and requirement documents

## Local Development

### Prerequisites

- Node.js 18 or later
- npm 9 or later

### Install

At repository root:

```bash
npm install
npm run install:all
```

### Run Full Stack

At repository root:

```bash
npm run dev
```

Default local endpoints:

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000/api
- Health check: http://localhost:4000/api/health

### Run Services Separately

```bash
npm run dev:backend
npm run dev:frontend
```

## Demo Credentials

- Email: demo@coreinventory.app
- Password: demo12345

## Deployment

Render deployment configuration is included in render.yaml.

Detailed deployment instructions are available in DEPLOYMENT.md.

## API Highlights

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/reset-password
- GET /api/users/me
- GET /api/dashboard/kpis
- GET /api/dashboard/filters
- GET /api/products
- POST /api/products
- PUT /api/products/:id
- GET /api/operations
- POST /api/operations
- POST /api/operations/:id/validate
- GET /api/ledger
- GET /api/locations

## License

This project is developed as part of a product engineering and hackathon workflow.
