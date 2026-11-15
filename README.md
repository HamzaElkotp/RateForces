# RateForces

RateForces is a client-rendered Codeforces practice-round companion. The browser owns presentation and interactions; the API owns verification, round state, and synchronization. The worker handles scheduled background jobs.

## Current implementation

Phase 0 establishes the React/Vite SPA, Express API, separate worker process, PostgreSQL/Prisma data model, environment validation, shared workspace scripts, and local database service. Later roadmap phases add Codeforces integration and product workflows in order.

## Database setup (Neon)

Create a PostgreSQL project in Neon, then copy both connection strings from its **Connect** dialog into `.env`:

- `DATABASE_URL`: pooled hostname (contains `-pooler`) for API and worker connections.
- `DATABASE_URL_UNPOOLED`: direct hostname for Prisma migrations.

The schema uses Prisma 6, which supports `directUrl` for migration commands. Neon documents separate pooled and direct URLs for application and schema operations in its [Prisma connection guide](https://neon.com/docs/guides/prisma).

Node.js 20 or newer and npm 10 or newer are required. Docker Compose remains available as an optional local PostgreSQL alternative.

## Local development

1. Copy `.env.example` to `.env`, fill in both Neon URLs, and set a random `SESSION_SECRET` of at least 32 characters.
2. Install dependencies with `npm install`.
3. Generate the Prisma client and apply migrations: `npm run db:generate`, then `npm run db:migrate`.
4. Start API, web app, and worker together: `npm run dev`.

The web app runs at <http://localhost:5173>, and the API health endpoint is <http://localhost:3001/api/health>. Vite proxies `/api` requests to the API.

For production deployments, build with `npm run build`, apply committed migrations using `npm run db:deploy`, and run the API and worker as separate processes. Keep the database private and provide the same environment configuration to both backend processes.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `API_PORT` | Express API port (default `3001`) |
| `WEB_ORIGIN` | Allowed browser origin for credentialed API requests |
| `CODEFORCES_API_BASE` | Codeforces API base URL |
| `CODEFORCES_REQUEST_INTERVAL_MS` | Central Codeforces request spacing |
| `VERIFICATION_CONTEST_ID` | Configured CE challenge problem contest ID |
| `VERIFICATION_PROBLEM_INDEX` | Configured CE challenge problem index |
| `SESSION_SECRET` | Secret reserved for secure session handling |

## Repository layout

```text
apps/
  api/       Express API, Prisma schema, and migrations
  web/       React single-page application
  worker/    Background job process
packages/    Shared domain/API types (introduced with feature work)
```

See [rateforces-project-spec.md](rateforces-project-spec.md) for product behavior, architecture constraints, and the ordered implementation roadmap.
