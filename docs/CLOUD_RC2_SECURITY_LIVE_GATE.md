# HisaFlow Cloud v1.0.0 RC2 — Security & Live-Gate Closure

RC2 fixes issues exposed by the first real Windows/Nest/PostgreSQL test of RC1.

- Nest TypeScript compile fixes: PostgreSQL/Express typings, runtime port config, Nest-compatible HTTP 429, typed CORS callback.
- Explicit body-parser ownership so REQUEST_BODY_LIMIT is effective.
- Revoked devices are rejected on sync pull as well as push; pull now requires the permanent device ID.
- Device protocol validation uses HTTP exceptions instead of generic errors.
- Requested local shop IDs are UUID-validated and collisions return a controlled conflict.
- The live two-device PostgreSQL test now proves a revoked device cannot push or pull.
- The integration contract no longer hard-codes an enumeration of historical package versions.

Local SQLite remains authoritative for offline operation. Revocation affects cloud synchronization, not the ability to complete a local sale while offline.

## Live gate
From `server/`, set DATABASE_URL/JWT_SECRET/PORT/NODE_ENV, then run `npm install`, `npm run db:migrate`, `npm run build`, `npm run test:contracts`, and `npm run test:e2e`.
