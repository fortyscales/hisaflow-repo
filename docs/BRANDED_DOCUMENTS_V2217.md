# HisaFlow Desktop v2.2.17 — Branded Business Documents

Adds a reusable shop document identity on top of v2.2.16 sync-pull atomicity fixes.

Business & Branding settings now support logo, tagline, address, business phone, email, registration number and a reusable document footer/payment instruction block. The existing TIN/VRN settings are reused.

Branding is applied to quotation/proforma PDFs, invoice register PDFs, printable invoices, sale receipts, credit-payment receipts, order tickets, PDF reports and PDF account statements. Logo data remains offline-capable in the existing settings JSON; no new database column is required for fresh installs or upgrades.

Fresh-install regression protection is retained: Dashboard empty state uses `transactionCount`, not the removed `sales` state. v2.2.16 atomic sync-pull behavior is unchanged.
