# Desktop Cloud Sync v0.3

The desktop remains offline-first. Business commands commit to SQLite first and emit durable outbox events. Cloud sync runs separately.

Flow: lease outbox -> POST /api/v1/sync/push -> ACK/fail locally -> GET /api/v1/sync/pull -> apply unseen remote events in one SQLite transaction -> persist inbox event IDs and cursor.

## Safety rules
- A network failure releases the lease and never rolls back a local business transaction.
- Event IDs make server ingestion idempotent; `sync_inbox.event_id` makes desktop pull idempotent.
- Remote writes have their trigger-generated outbox rows removed inside the same SQLite transaction, preventing echo loops.
- `products.stock` is not accepted from a remote product snapshot. FIFO `stock_batches` synchronize and the local stock projection is recomputed from batches.
- Access and refresh tokens stay in Electron main; encrypted token material is stored with Electron `safeStorage`, not renderer localStorage.
- Pull cursor advances only in the transaction that records/applies the pulled changes.

This is the transport foundation. Conflict UX, automatic scheduling/network backoff UI, and full multi-device acceptance testing remain later gates.
