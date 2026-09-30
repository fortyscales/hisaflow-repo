# Inventory reconciliation — Cloud v0.6.0

HisaFlow remains offline-first. Two disconnected tills can physically sell the same last units; no distributed system can prevent that without requiring an online reservation/lock. HisaFlow therefore detects the discrepancy after synchronization instead of hiding it.

## Authority model

`products.stock` is never accepted as a cloud last-write-wins value. The server derives a shop/product inventory position from immutable `stock_movement` entity snapshots by summing `quantity_delta`.

If the derived position falls below zero, the server creates one durable active `OVERSELL` issue for that shop/product. Further events update its current quantity rather than creating alert spam. The issue can be acknowledged by a merchant, but acknowledgment does not alter inventory.

A real compensating stock movement/adjustment must be made through HisaFlow. When subsequent synced movements bring the derived position to zero or above, the server automatically marks the issue resolved. This preserves the audit trail.

## Offline invariant

Detection is post-sync observability. It never participates in or blocks the local SQLite sale transaction.
