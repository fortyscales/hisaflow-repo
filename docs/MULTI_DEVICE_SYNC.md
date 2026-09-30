# HisaFlow Cloud v0.4 — Multi-device synchronization

## Invariants
- A local sale commits to SQLite before any network operation.
- Background sync runs after startup, every 60 seconds while configured, on network-online events, and manually from the sync indicator.
- Only one sync run executes at a time.
- Remote events are idempotent through `sync_inbox`.
- Remote writes do not echo back into the outbox.
- `products.stock` is never accepted as a last-write-wins cloud field; local stock remains a FIFO-batch projection.

## Conflict behavior
The server rejects stale versions and same-version writes arriving from a different device. The response includes the authoritative server version/payload. Desktop records the conflict in `sync_conflicts`, terminally acknowledges that exact outbox event so it cannot retry forever, then pulls server changes. When the authoritative version is applied locally the conflict is marked resolved.

This is deliberate conflict detection, not silent overwrite. Stock-event reconciliation remains event-oriented; HisaFlow does not resolve inventory by copying a product stock number between devices.

## Status UI
The sidebar shows Offline, Syncing, Up to date, Sync error, or Sync needs attention. Pending event count is visible and clicking the status requests a sync. English and Kiswahili labels are provided.
