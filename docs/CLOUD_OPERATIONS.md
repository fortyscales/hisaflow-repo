# HisaFlow Cloud Operations — v0.9.0

This increment makes cloud connection deployable from the desktop UI rather than requiring hidden/manual setup.

## Merchant workflow
- Sign in or create a HisaFlow Cloud account from Cloud & Devices.
- New registrations preserve the desktop's existing `shop_id`, so the local SQLite tenant and PostgreSQL tenant have one identity.
- Inspect registered devices and last-seen state; rename or revoke devices.
- Inspect recent accepted synchronization events with source device and entity/version.
- Inspect durable local conflicts instead of hiding them behind a counter.
- English and Kiswahili labels are provided for the new operations UI.

## Tenant rule
A local SQLite database represents one shop. A multi-shop owner may own several server shops, but a single local database is not silently switched between shop IDs. Cloud & Devices verifies that the authenticated account has membership in the local shop. This prevents accidentally syncing one shop's local database into another shop.

## Offline invariant
Cloud authentication, history and administration can fail without blocking local sales. Business mutations still commit to SQLite first and wait in the outbox.
