# boltirakhi-backend

Express + TypeScript + MongoDB backend for [boltirakhi.com](https://boltirakhi.com).

## Setup

```bash
npm install
cp .env.example .env    # then fill in the values
npm run dev
```

Requires **Node >= 20**.

### Required accounts
| Service | What you need |
|---|---|
| MongoDB Atlas | Connection string — must include `/boltirakhi` as the DB name |
| AWS S3 | Bucket in `ap-south-1`, plus an IAM user's access key / secret |

S3 layout: `products/` and `categories/` are public-read via bucket policy so
storefront URLs stay stable; `bolti/` stays private and is served through
short-lived signed URLs, since those are personal family videos.

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with watch (tsx) |
| `npm run build` | Compile TS → `dist/` |
| `npm start` | Run compiled build (production) |
| `npm run seed` | Create the admin user |
| `npm run typecheck` | Type check, no emit |
| `npm run lint` | ESLint |

## Conventions

- **CommonJS**, not ESM.
- **Relative imports only** — no path aliases (`tsc` does not rewrite them in build output).
- Each module has 4 files:
  - `*.routes.ts` — URLs + middleware chain only
  - `*.controller.ts` — req/res handling, calls the service
  - `*.service.ts` — all business logic + DB queries, never touches `req`/`res`
  - `*.schema.ts` — zod schemas
- Business logic lives in services so the public site can reuse it.
- Read env only via `src/config/env.ts` — never `process.env` directly.

## Plan

See [`../backend-admin-detailed-plan.md`](../backend-admin-detailed-plan.md).
