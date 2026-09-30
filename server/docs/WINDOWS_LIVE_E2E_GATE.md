# Windows Live E2E Gate — v1.0.0-rc.3

RC3 replaces the integration harness' Windows `npm.cmd` child-process launch with a direct invocation of the Nest CLI through the active Node executable (`process.execPath`). This avoids `spawn EINVAL` on Windows while keeping the runner portable across Windows, macOS, and Linux.

The live gate still performs migrations, waits for `/api/v1/health/ready`, then executes the real two-device PostgreSQL/HTTP scenario including idempotent duplicate delivery, cross-device pull, concurrent-version conflict detection, unregistered-device rejection, and revoked-device rejection for both push and pull.

Run from `server/` with the integration PostgreSQL container healthy:

```powershell
$env:DATABASE_URL="postgresql://hisaflow:hisaflow_dev@127.0.0.1:54329/hisaflow"
$env:JWT_SECRET="integration-only-change-me-please"
$env:PORT="4100"
$env:NODE_ENV="test"
npm run build
npm run test:contracts
npm run test:e2e
```
