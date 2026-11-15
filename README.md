# RateForces

RateForces is a client-rendered Codeforces practice-round companion. The browser owns presentation and interactions; the API owns verification, round state, and synchronization. The worker handles scheduled background jobs.

## Current implementation

The app includes Codeforces problemset ingestion, verified account linking, solved-history sync, configurable practice rounds, lobby cancellation, timed sessions, submission tracking, results, and theme support. The API, web app, and worker run as separate services over PostgreSQL/Prisma. See the implementation roadmap in the spec for remaining release-readiness work.

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

Run the deterministic unit suite with `npm test` before committing changes.

For database-backed lifecycle tests, copy `.env.test.example` to `.env.test`, start the isolated PostgreSQL service with `docker compose --profile test up -d test-postgres`, then run `npm run test:integration`. The runner applies migrations to `TEST_DATABASE_URL` and refuses to target the main `DATABASE_URL`.

Run the browser end-to-end flow with `npm run test:e2e` after starting the same test PostgreSQL service. It launches an isolated API and Vite server on free local ports, uses Microsoft Edge, and stubs the Codeforces API. It exercises account verification, round preview and creation, starting work, and accepted-submission synchronization. It seeds and removes test-only rows in `TEST_DATABASE_URL` and refuses to use `DATABASE_URL`.

The web app runs at <http://localhost:5173>, and the API health endpoint is <http://localhost:3001/api/health>. Vite proxies `/api` requests to the API.

For a containerized production deployment, configure `.env`, apply committed migrations with `npm run db:deploy`, then build and start the API, worker, and web containers using `docker compose -f docker-compose.app.yml up --build -d`. The web container serves the SPA and proxies `/api` to Express. The API and worker are separate processes. Keep database credentials server-side and use a Neon pooled URL for runtime plus its direct URL for migrations.

For a Vercel web deployment, create a second project from this repository with Root Directory `apps/web`. Its `vercel.json` proxies `/api/*` requests to the `rateforces-api` deployment and routes SPA paths to `index.html`. Set the API project's `WEB_ORIGIN` to the deployed web origin. Preview web deployments currently use the production API, so don't use previews for data-changing tests until a separate preview API/database is configured. The worker still needs a separate persistent runtime; Vercel's API project does not run it.

### Neon recovery procedure

Set a point-in-time restore window in Neon that matches the recovery period you need, and review its storage cost. Before launch, rehearse recovery against a disposable branch. Neon can restore a branch from a timestamp or WAL position; see its [point-in-time restore guide](https://neon.com/blog/announcing-point-in-time-restore).

For an incident:

1. Pause the worker and application writes while you assess the incident. Record the affected branch and estimate a recovery timestamp before the bad change.
2. In Neon, open **Restore** for the affected branch. Use Time Travel Assist with read-only queries to confirm the data at the proposed timestamp.
3. Restore to a separate branch first when you need to inspect or selectively recover data. If the whole database must be rewound, use Neon's branch restore flow and keep the pre-restore branch until validation finishes; a full rewind discards writes after the recovery point.
4. If the restored branch has a different endpoint, update `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel, then redeploy the API and worker. Check schema compatibility before applying migrations with `npm run db:deploy`.
5. Verify the expected problem and round data, test an authenticated read, and check `/api/health/live` plus `/api/health` after the worker heartbeat returns. Resume writes after validation and retain the old branch until the service is stable.

The readiness endpoint `/api/health` checks database connectivity and the worker heartbeat; `/api/health/live` is the API liveness check. The worker removes verification challenges one day after expiry, expired sessions immediately, and revoked sessions after one day.

## Environment variables

| Variable                         | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                   | PostgreSQL connection string                         |
| `API_PORT`                       | Express API port (default `3001`)                    |
| `WEB_ORIGIN`                     | Allowed browser origin for credentialed API requests |
| `CODEFORCES_API_BASE`            | Codeforces API base URL                              |
| `CODEFORCES_REQUEST_INTERVAL_MS` | Central Codeforces request spacing                   |
| `VERIFICATION_CONTEST_ID`        | CE challenge problem contest ID (default `1`)        |
| `VERIFICATION_PROBLEM_INDEX`     | CE challenge problem index (default `A`)             |
| `SESSION_SECRET`                 | Secret reserved for secure session handling          |

## Repository layout

```text
apps/
  api/       Express API, Prisma schema, and migrations
  web/       React single-page application
  worker/    Background job process
packages/    Shared domain/API types (introduced with feature work)
```

See [rateforces-project-spec.md](rateforces-project-spec.md) for product behavior, architecture constraints, and the ordered implementation roadmap.
