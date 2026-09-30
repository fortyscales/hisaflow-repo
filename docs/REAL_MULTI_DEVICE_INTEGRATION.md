# HisaFlow Cloud v0.5 — Real two-device integration gate

This release adds a runnable PostgreSQL + NestJS HTTP integration harness. It is intentionally separate from the fast source/contract tests.

## Gate

From `server/`:

```bash
npm install
npm run integration:up
npm run db:migrate
npm run build
npm run test:e2e
npm run integration:down
```

`test:e2e` starts HisaFlow Cloud, waits for `/api/v1/health`, and drives two independently authenticated device identities through the public HTTP API.

The scenario proves: merchant registration and shop creation; Device A and Device B registration; Device A push; Device B pull; duplicate event idempotency; same-version concurrent edit conflict; and rejection of an unregistered device identity.

## Release rule

Do not claim real PostgreSQL multi-device verification until this gate has been run against an actual PostgreSQL instance. The normal contract suite only proves structure and invariants without a live database.

## Inventory boundary

Offline operation means two disconnected tills can sell against the same last units. HisaFlow must never hide this reality with last-write-wins stock. The current sync protocol detects concurrent snapshot versions and preserves conflicts. A later inventory reconciliation phase will add explicit oversell/reconciliation workflows based on immutable inventory events.


## v0.6 oversell scenario
After the basic two-device gate, test both devices selling the final physical units while disconnected. Once both outboxes synchronize, query `GET /api/v1/inventory/reconciliation/issues?shopId=...`. The server must expose one active `OVERSELL` issue for the product. Acknowledging the issue must not change stock. Record a real compensating stock adjustment on one desktop; after it synchronizes and the derived movement position is non-negative, the issue must become RESOLVED.
