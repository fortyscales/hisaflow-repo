# HisaFlow Architecture — v0.5

## Source of truth

SQLite is the authoritative local business database. React state is disposable UI state. Session
storage may hold session/UI convenience state only. Losing renderer state must never lose or alter a
sale, credit, payment, stock movement, purchase/restock, expense, supplier record or order.

## Write path

Renderer -> preload IPC -> application/query command -> SQLite transaction -> domain service ->
repositories/tables -> stock movement + sync outbox -> commit -> UI refresh.

A transaction is successful only after SQLite commits. Network availability is not part of the
local success path.

## Inventory truth

- `stock_batches.remaining`: authoritative sellable quantity by FIFO layer.
- `stock_movements`: append-only audit history of inventory changes.
- `products.stock` and `products.buying_price`: cached projections for fast reads.
- `inventoryService`: only approved place for FIFO consume/restore/projection rules.

## Cloud path

SQLite -> durable `sync_outbox` -> sync worker -> NestJS API -> PostgreSQL.

Server responsibilities later: authentication, tenant/shop isolation, conflict policy, canonical
cross-device state, reporting, web storefront and integrations. The desktop must remain usable when
the server or internet is unavailable.

## Migration strategy

Move one business capability at a time out of `queries.js`:
1. Inventory (started in v0.5)
2. Sales
3. Purchases/restock
4. Credit
5. Orders
6. Expenses
7. Suppliers
8. Reporting/analytics

Each capability should have a domain/application service and a narrow repository contract. Avoid
putting HTTP/NestJS concepts into the domain layer.


## v0.6 Sales reliability
- Cash sale and cart checkout business rules now live in `electron/domain/salesService.js`.
- Checkout commands support durable idempotency receipts in SQLite. Replaying the same operation ID returns the original committed result without consuming stock twice.
- Reusing an operation ID with different input is rejected.
- New business IDs use UUIDs, preparing local records for multi-device NestJS/PostgreSQL sync.
- Order fulfillment remains atomic with cart checkout.
- SQLite remains authoritative; the renderer only submits commands and renders returned/query data.


## v0.7 — Query Performance & Granular Writes

- Sales history UI is paginated and searched inside SQLite rather than loading the full sales table into React.
- Expense creation/deletion uses row-level commands; the normal UI no longer rewrites the expenditure table.
- Activity logging is append-only at the IPC/database boundary and bounded with SQL pruning instead of read-modify-write.
- Added interactive query indexes for sales, expenses, activity and crash history.
- Full-history readers/writers remain only where compatibility, export, reporting, or atomic backup restore still requires them; they are not the target architecture for normal UI mutations.

## v0.8 Analytics query boundary
Dashboard financials and rankings are query-side projections computed by SQLite. The renderer requests compact summaries and must not load full sales, credit-sales, or expense histories for dashboard calculations. This query contract is intentionally portable to PostgreSQL/NestJS later.

## v0.9 — Accounting-grade inventory ledger

Inventory now has three deliberately different representations:

1. `stock_movements` is the append-only audit history: every quantity change must leave a movement.
2. `stock_batches.remaining` is the FIFO allocation state used to know which cost layer is still on hand.
3. `products.stock` and `products.buying_price` are rebuildable read projections for fast UI queries.

The database migration reconciles the legacy movement baseline to retained FIFO on-hand stock before the v0.9 rules begin. Context-aware SQLite triggers then guarantee that even a future code path that changes a batch cannot silently bypass the ledger. Domain operations add semantic context (`SALE`, `RETURN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, etc.) and references to the business operation.

### Inventory invariant

For every product after v0.9 migration and every committed inventory transaction:

`products.stock == SUM(stock_batches.remaining) == SUM(stock_movements.quantity_delta)`

`products.stock` may be repaired from batches because it is only a projection. A ledger/batch mismatch is never silently repaired: it is surfaced by the reconciliation report because changing an append-only audit history must be an explicit business action.

### PostgreSQL/NestJS mapping

`stock_movements` maps naturally to an immutable PostgreSQL inventory ledger. `reference_type`, `reference_id`, `device_id`, `shop_id`, and the sync outbox make each movement traceable and syncable. NestJS should expose inventory commands, not generic row updates. PostgreSQL should apply those commands idempotently and retain the same movement semantics.

## v1.0 Reliability Core

Core financial mutations now cross explicit domain boundaries. Purchases/restocks, credit sales/payments/deletion, expenses, cash sales and inventory adjustments are transaction-owned commands rather than UI-owned state changes. Commands accept optional `operationId` values and persist receipts in SQLite, so retries can return the original result instead of duplicating a financial mutation.

SQLite guard triggers enforce invariants on legacy databases without destructive table rebuilds. Invalid FIFO batches, negative cached stock, invalid credit balances, non-positive payments and non-positive expenses are rejected at the database boundary. These guards are intended to become PostgreSQL `CHECK` constraints when the server database is introduced.

Native SQLite snapshots are the preferred disaster-recovery format because they preserve the entire local database: ledger, operation receipts, sync outbox, schema migrations and business records. JSON restore remains a compatibility path for older backups and intentionally rebuilds a clean inventory-ledger baseline from restored batches.

## v1.1 Sync Protocol

SQLite remains authoritative for offline work. The sync layer transports committed facts; it never makes a local sale depend on the network.

Each outbox event is exposed as a protocol-v1 envelope containing `eventId`, `entityType`, `entityId`, `operation`, `shopId`, `deviceId`, `occurredAt`, `entityVersion`, `payload`, and an explicit tombstone for deletes. Event IDs are idempotency keys on the future NestJS server.

Workers lease a bounded batch before sending it. Acknowledgement marks only events from that lease as synced. Failures use exponential backoff and become dead letters after repeated failure or a permanent server rejection. A crashed worker simply lets its lease expire, so events are not lost.

Future NestJS/PostgreSQL contract: accept each `eventId` once; scope all merchant data by `shopId`; preserve `deviceId` for audit; assign a server revision on accepted mutations; reject invalid tenant/entity combinations; return per-event acknowledgements. Conflicts must be explicit. Financial and stock history should converge through immutable/idempotent business events rather than last-write-wins rewriting of history.

Pull sync is intentionally not implemented in the desktop client until the NestJS contract exists. When added, remote mutations must be applied inside one SQLite transaction with outbox suppression so downloaded changes are not echoed back to the server.


## v1.2.0 — PostgreSQL-ready tenant model

Core merchant-owned SQLite rows now carry `shop_id` and `device_id`, with tenant-scoped indexes and a documented cross-runtime data contract. `docs/postgresql-schema.sql` is the target server schema contract and `docs/NESTJS_MIGRATION_CONTRACT.md` defines IDs, timestamps, versions, idempotency, tombstones, tenant authorization, and offline sync behavior. SQLite remains the local source of truth while offline.

## v1.3 — Repository isolation and command/query boundary
SQLite statements are now being extracted behind repository contracts. `expenseService` is the first fully isolated write domain: it depends on repositories plus an explicit transaction runner and contains no SQL. Shared repositories now cover operation receipts, activities, expenses, orders, sales, and products. This is deliberately incremental; inventory/credit/purchase remain migration targets rather than being rewritten unsafely in one pass. New domain code must not add ad-hoc SQL.

## v1.4 — Core domain repository isolation
Inventory, credit, and purchase domain services no longer prepare SQL or own better-sqlite3 transactions. SQLite persistence for FIFO batches/movement context is isolated in `inventoryRepository`; credit persistence is isolated in `creditRepository`. All core mutation domains now receive repositories and the transaction runner as dependencies. This is the portability boundary required for future PostgreSQL adapters behind NestJS.

## v1.5 — Application command/query boundary

HisaFlow now has an explicit `electron/application` layer. Core renderer mutations and high-value analytics reads cross IPC through `app:command` and `app:query`, using object-shaped DTO contracts. This boundary is intentionally transport-neutral: Electron IPC is today's adapter; future NestJS HTTP/WebSocket controllers and mobile clients can use the same command/query vocabulary. Repositories remain below domain/application logic and are not exposed to clients.


## v1.6 — Closed renderer mutation surface

Routine renderer mutations now cross one application command boundary (`app:command`). The preload bridge no longer exposes whole-table save functions for products, sales, credit sales, expenses, suppliers, staff, activity logs, or crash logs. Product, staff, supplier, order, sale-edit/delete, and diagnostic crash-log writes are routed through named application commands. Full-table compatibility writers remain private to the main-process backup/restore implementation only; they are not renderer APIs. Backup restore remains an explicit privileged maintenance path, separate from normal business commands.

Crash logging is granular: a crash appends one bounded row and clearing logs issues an explicit clear command instead of read-modify-rewrite of the entire table. This closes a race and reduces IPC/database work during failure handling.

## v1.7 — Backup, Recovery & Integrity
Native SQLite snapshots are now the primary disaster-recovery format. Snapshots receive full integrity/foreign-key validation plus a SHA-256 manifest. Restore is guarded by schema compatibility, a verified pre-restore safety snapshot, staged validation, WAL shutdown, atomic replacement workflow and application relaunch through migrations/startup health checks. Legacy JSON restore remains compatibility-only and is not considered a complete accounting backup. See `docs/BACKUP_RECOVERY.md`.

## v1.8 — Failure testing and consistency gates
Reliability is now tested as behavior, not only documented as architecture. The failure-injection harness deliberately throws after stock consumption, after restock mutation, and between credit balance/payment writes and verifies that the transaction boundary restores the prior state. It also verifies operation-ID replay safety and idempotency conflicts. Startup/database health now reports stale sync leases and malformed operation receipts in addition to stock, ledger, FK, batch, credit, and payment invariants.

The production rule is: every new money, stock, credit, order, or sync mutation must ship with a test proving both its successful invariant and at least one mid-operation failure/rollback path.

## v1.9 — production error boundary
The application transport returns stable result envelopes instead of leaking raw persistence exceptions to React. Error codes are transport-safe and retryability is explicit. Startup integrity state and diagnostic export form the operational support boundary; diagnostics expose health/status metadata, not merchant business records.

## v2.0 — production validation boundary

Architecture changes now require a repeatable release gate. `npm run test:production` combines syntax validation, architecture contracts, failure-injection tests, the production-readiness contract, and the Vite production build. Native `better-sqlite3` must additionally be rebuilt against the exact Electron runtime and exercised through real launch/package acceptance tests before a release is called production-ready.


## v2.0.1 — Legacy migration hotfix
Existing installations may already contain an older `sync_outbox` table. SQLite `CREATE TABLE IF NOT EXISTS` does not add missing columns to such a table, so v2.0.0 could fail at startup while creating the `entity_type` index. v2.0.1 repairs the legacy outbox shape and backfills legacy rows before any index or trigger references the new columns. This upgrade is additive and does not require deleting the user's database.


## v2.0.2 legacy outbox hotfix
Startup now performs a transactional compatibility preflight that rebuilds pre-v1 `sync_outbox` tables containing the obsolete `event_type NOT NULL` column into the canonical sync envelope before any pending migration or trigger can write to the outbox. Legacy event types and payloads are preserved where possible.


## v2.0.3 real legacy outbox hotfix
The migration preflight is now verified against the captured historical database shape: legacy sync_outbox uses TEXT event ids, event_type TEXT NOT NULL, and 36 durable-sync triggers already reference sync_outbox. The compatibility rebuild preserves event_id but lets SQLite allocate new INTEGER row ids, temporarily removes dependent triggers while replacing the table, then restores their original SQL. This avoids both the legacy NOT NULL event_type failure and SQLite schema-validation failure during table replacement.

## v2.1.5 financial document rule
For a converted commercial document, inventory sales record revenue net of document discount and exclusive of sales tax. Tax is a separately persisted liability in `tax_ledger`. The final invoice is the customer-facing gross document and persists subtotal, discount, tax rate, tax amount and total. Credit receivables include tax because it is owed by the customer, while sales profit does not count tax as revenue.


## v2.2.4 Desktop Polish RC
The desktop feature surface is frozen. This release standardizes sticky screen headers, loading/focus/scroll states, improves transaction metadata, and adds account filtering to applicable Sales and Expense reports. Reports default to Today. No new business domain was introduced.
