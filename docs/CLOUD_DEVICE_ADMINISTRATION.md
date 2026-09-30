# Cloud Device Administration — v0.8.0

HisaFlow owners/admins can list devices registered to a shop, see last-seen state, and revoke a lost or retired device. Revocation is durable in PostgreSQL and sync push rejects revoked devices. A revoked device remains visible for audit history and is never silently deleted.

The local desktop continues to operate offline after revocation; revocation removes cloud synchronization authority, not access to the local SQLite database. Device administration therefore cannot block local sales.

Security rules:
- listing requires shop membership;
- rename/revoke requires owner or admin membership;
- a device ID cannot be moved to another shop through registration;
- a revoked device cannot silently re-register itself;
- sync verifies the device is active for the shop.
