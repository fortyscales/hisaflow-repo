# HisaFlow Desktop 2.2.15 — Existing Cloud Shop Join

Fixes fresh Device-B onboarding when an existing cloud user signs in.

- After login, Desktop reads `/shops/mine`.
- If the local database has no operational business rows and no pending outbox events, and the account has exactly one cloud shop, the fresh local `shop_id` is rebound to that authorized cloud shop.
- `device_id` remains unique to the new device.
- Pull cursor resets to `0`, so the device can hydrate from the cloud.
- Non-empty local databases are never silently rebound; they fail with `CLOUD_SHOP_BIND_REQUIRES_EMPTY_LOCAL_DATABASE` and must use an explicit adoption path.
- An IPC `cloud:joinShop` contract is included for explicit shop selection when multi-shop UI is added/used.
- Includes the fresh Dashboard fix: empty state uses SQLite analytics `transactionCount`, not removed `sales` state.
