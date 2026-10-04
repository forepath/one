# Admin File Explorer

Read-only browsing and download of billing files stored through the shared `FileStorageProvider` (active backend selected by `FILE_STORAGE_PROVIDER`).

## Overview

Administrators open **Administration → File Explorer** in the billing console. The UI shows a virtual file tree built from **database storage keys** (not a raw bucket listing). Orphan objects on disk/S3 that are not referenced by tenant-scoped entities are never shown or downloadable.

Supported actions:

- Browse folders (lazy expand)
- Download a single file
- Download a folder (and its subtree) as ZIP

Upload, rename, move, and delete are out of scope.

## Storage scopes

Top-level folders map to file-storage scope segments:

| Folder              | Scope              | Sources                                                  |
| ------------------- | ------------------ | -------------------------------------------------------- |
| `invoices`          | `invoices`         | Invoice PDFs, time reports, void/credit docs, offer PDFs |
| `supplier-invoices` | `supplierInvoices` | Supplier invoice documents                               |
| `datev-exports`     | `datevExports`     | Completed DATEV export ZIPs                              |

## Multi-tenant views

Like DATEV admin exports, File Explorer is tenant-enclosed by default:

- Request tenant comes from `X-Tenant` (console `billing.tenantId`).
- List/download use an optional `viewTenantId` query for the selected tab.
- Foreign `viewTenantId` is accepted only when the request tenant is listed in **`TENANTS_ALLOW_GLOBAL_VIEWS`**.

When global views are allowed, the page shows one tab per configured tenant plus a **Unified** tab. Unified consolidates files from all configured tenants (tenant id as the first path segment) and includes DATEV unified exports under `_unified/datev-exports/...`.

Capabilities (`GET /admin/billing/capabilities`) expose:

- `globalViewsAllowed`
- `viewableTenants`
- `unifiedExportAllowed` (DATEV-specific; still requires `BILLING_DATEV_UNIFIED_EXPORT_ENABLED`)

## API

Admin-only (`ADMIN` roles + `billing_admin:read`):

- `GET /admin/billing/files`
- `GET /admin/billing/files/download`
- `GET /admin/billing/files/archive`

Archives are capped by entry count and total uncompressed size.

## Security

- Path traversal and absolute paths are rejected.
- Every download/archive member must be in the DB allow-set for the resolved view.
- Non-allowlisted tenants cannot open Unified or switch to another tenant’s tab.
- Clients never receive storage roots or provider credentials.
