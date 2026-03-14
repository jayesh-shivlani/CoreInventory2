# Contributing

Thank you for your interest in improving Core Inventory IMS.

## Development Workflow

1. Create a feature branch from main.
2. Implement focused changes with clear commit messages.
3. Run local checks before opening a pull request.
4. Open a pull request with a short summary and test notes.

## Local Setup

```bash
npm install
npm run install:all
npm run dev
```

## Quality Checks

```bash
npm run lint
npm run build
```

## Pull Request Checklist

- [ ] Scope is clear and limited
- [ ] No secrets or credentials are committed
- [ ] Documentation is updated if behavior changed
- [ ] Build/lint passes locally

## Security

Do not commit `.env` files, API keys, tokens, or database credentials.
