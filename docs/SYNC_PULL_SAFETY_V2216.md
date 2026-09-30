# Sync pull safety — v2.2.16

The desktop must never advance `sync_pull_cursor` past a server change that it cannot safely consume.

Changes in this hotfix:
- The full ordered pull page is passed to the SQLite applier; own-device rows are no longer filtered before cursor advancement.
- Server snake_case and camelCase protocol fields are normalized at the boundary.
- Malformed changes, unsupported entities, and empty UPSERT payloads abort the SQLite transaction.
- Own-device changes are accepted only when their event ID exists in the local outbox. An unknown event claiming the local device ID raises `CLOUD_DEVICE_ID_COLLISION` and leaves the cursor unchanged.
- Entity writes, inbox receipts, sync-echo cleanup, and cursor advancement remain in one SQLite transaction; cursor advancement is the final write.

This prevents a successful-looking pull from silently skipping remote business data.
