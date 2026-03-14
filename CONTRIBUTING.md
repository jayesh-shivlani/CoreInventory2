# Contributing

Thanks for contributing to Core Inventory IMS.

## Prerequisites

- Node.js 18+
- npm 9+
- PostgreSQL with valid `DATABASE_URL`

## Setup

From repository root:

```bash
npm install
npm run install:all
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

Set at least `DATABASE_URL` in `backend/.env`.

## Development

Run both apps:

```bash
npm run dev
```

Or run separately:

```bash
npm run dev:backend
npm run dev:frontend
```

## Quality Checks

Before opening a PR:

```bash
npm run lint
npm run test:smoke:api
npm run build
```

## Commit and PR Guidelines

- Use clear commit messages with scope.
- Keep PRs focused and small when possible.
- Include a short test summary in PR description.
- Add screenshots or API examples for UI/API behavior changes.
- Update docs when behavior, routes, env vars, or setup changes.

## Code Style

- Preserve existing project structure and naming conventions.
- Prefer small, explicit functions over large, complex blocks.
- Validate inputs on API boundaries.
- Avoid introducing breaking changes without documenting them.

## Security Notes

- Do not commit secrets.
- Use `.env` files locally only.
- Keep CORS and JWT settings environment-driven.
