# HisaFlow Cloud foundation

Desktop v2.2.8 is the offline merchant runtime. The cloud backend starts as a separate boundary under `server/`.

## Invariants
- Local sale commits to SQLite without network access.
- Client IDs are preserved by the server.
- Push is idempotent by eventId.
- Authorization comes from authenticated shop membership, never from a submitted shopId alone.
- Pull is an ordered per-shop cursor feed.
- Deletes are tombstones.
- Stale entity versions become explicit conflicts.
- Stock is not synchronized by blindly overwriting `products.stock`; immutable stock/business events remain the reconciliation source.

## Next increments
Authentication/onboarding, server domain materializers, desktop background transport, downloaded-change application with outbox suppression, sync observability, then public merchant/profile APIs.
