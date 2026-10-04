# Admin File Explorer

Read-only browsing and download of billing files stored through the shared `FileStorageProvider` (active backend selected by `FILE_STORAGE_PROVIDER`).

## Overview

Administrators open **Administration → File Explorer** in the billing console. The UI shows a virtual file tree built from **database storage keys** (not a raw bucket listing). Fixed structural folders (`customer/{invoices,offers,timesheets}`, `supplier/invoices`, `export/datev`) are always shown; dynamic folders (DATEV year/month, subscription keys, …) appear only when files exist. Orphan objects on disk/S3 that are not referenced by tenant-scoped entities are never shown or downloadable.

Supported actions:

- Browse folders (lazy expand; refresh keeps open folders and reloads those paths)
- Download a single file
- Download a folder (and its subtree) as ZIP

Upload, rename, move, and delete are out of scope.

## Storage layout

Files live under `{FILE_STORAGE_ROOT}`:

| Virtual path          | Scope                | Sources                        |
| --------------------- | -------------------- | ------------------------------ |
| `customer/invoices`   | `customerInvoices`   | Invoice PDFs, void/credit docs |
| `customer/offers`     | `customerOffers`     | Archived offer PDFs            |
| `customer/timesheets` | `customerTimesheets` | Project time-report PDFs       |
| `supplier/invoices`   | `supplierInvoices`   | Supplier invoice documents     |
| `export/datev`        | `datevExports`       | Completed DATEV export ZIPs    |

A default-on layout migrator copies objects from the previous segments (`invoices/`, `supplier-invoices/`, `datev-exports/`) into this layout (local + S3). Dual-read remains enabled until cutover.

## Registry, hashes, and signatures

Every managed file has a `billing_stored_files` row with:

- UUID id and ticket-style identity SHA (`shas.short` / `shas.long`)
- Content digests: MD5, SHA-1, SHA-256, SHA-512
- Global HMAC-SHA256 signature (`BILLING_FILE_SIGNING_SECRET`) over a v1 envelope that **always includes tenant id**

BullMQ job `stored-files.backfill.*` fills hashes/signatures for backfilled rows. File Explorer shows a short-hash badge and lock icon with tooltip details.

## Multi-tenant views

Like DATEV admin exports, File Explorer is tenant-enclosed by default:

- Request tenant comes from `X-Tenant` (console `billing.tenantId`).
- List/download use an optional `viewTenantId` query for the selected tab.
- Foreign `viewTenantId` is accepted only when the request tenant is listed in **`TENANTS_ALLOW_GLOBAL_VIEWS`**.

When global views are allowed, the page shows one tab per configured tenant plus a **Unified** tab.

## API

Admin-only (`ADMIN` roles + `billing_admin:read`):

- `GET /admin/billing/files`
- `GET /admin/billing/files/download`
- `GET /admin/billing/files/archive`

## Security

- Path traversal and absolute paths are rejected.
- Every download/archive member must be in the DB allow-set for the resolved view.
- Signature status is shown in the UI; download/archive never blocks on missing or failed verification (failures are logged).
- Clients never receive storage roots, signing secrets, or provider credentials.
