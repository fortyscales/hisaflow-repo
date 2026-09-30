# HisaFlow Desktop 2.2.11 — Cloud UI wiring hotfix

This hotfix is based on Desktop 2.2.10 + Cloud v1.0.0-rc.3.

Changes:
- Wires Cloud & Devices and Stock Reconciliation into App.jsx and the Administration sidebar.
- Adds English/Kiswahili navigation labels.
- Adds the missing Electron IPC/preload bridge for cloud auth, devices, sync, conflicts, and reconciliation.
- Replaces the renderer sync stub with the real Electron cloud transport.
- Adds desktop migrations 18–20 for sync inbox/cursor, conflicts, and reconciliation cache.
- Defaults local cloud development URL to http://localhost:4100.
- Adds a regression contract for cloud navigation + transport wiring.

No existing business tables are dropped. Migrations are additive.
