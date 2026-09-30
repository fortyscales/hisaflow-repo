# HisaFlow Cloud v1.0 RC — Production Readiness Gate

This release freezes the synchronization foundation behind a deployment gate before storefront work begins.

## Runtime invariants
- Local SQLite sales never depend on cloud availability.
- Production startup fails for missing/weak JWT secrets, unsafe placeholder database URLs, or missing explicit CORS origins.
- `/api/v1/health/live` proves the process is alive; `/api/v1/health/ready` proves PostgreSQL is reachable.
- HTTP responses carry request IDs; logs are structured JSON and avoid request bodies, passwords, and tokens.
- Auth endpoints are rate-limited per client IP. Reverse-proxy trust is opt-in.
- PostgreSQL pool closes during graceful shutdown.
- Request bodies are bounded and PostgreSQL statements have a timeout.

## Production environment
Set NODE_ENV=production, DATABASE_URL, a random JWT_SECRET of at least 32 characters, and explicit comma-separated CORS_ORIGINS. Put TLS at the deployment proxy/load balancer and set TRUST_PROXY=true only when that proxy is controlled.

## Deployment gate
1. Install server dependencies and build.
2. Start PostgreSQL and run `npm run db:migrate` before the new server receives traffic.
3. Verify `/api/v1/health/live` and `/api/v1/health/ready`.
4. Run `npm run test:contracts` and the Docker two-device `npm run test:e2e` gate.
5. Verify Device A push -> PostgreSQL -> Device B pull, duplicate delivery, revoked device rejection, concurrent version conflict, oversell reconciliation, restart/reconnect, and expired-token refresh.
6. Back up PostgreSQL before destructive migrations. Current migrations remain additive.

A failed readiness probe, migration, E2E scenario, or data-integrity check is a release blocker.
