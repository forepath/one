# @forepath/shared/backend/util-file-storage

Shared NestJS file storage with a provider registry. Built-in backends: **local** filesystem and **s3** (S3-compatible object storage).

## Usage

```ts
import { FileStorageModule, FileStorageService, FileStorageScope } from '@forepath/shared/backend/util-file-storage';

@Module({ imports: [FileStorageModule] })
export class AppModule {}

// Inject FileStorageService:
await fileStorage.writeCustomerInvoiceFile(storageKey, buffer);
await fileStorage.writeCustomerOfferFile(storageKey, buffer);
await fileStorage.writeCustomerTimesheetFile(storageKey, buffer);
await fileStorage.readDatevExportFile(storageKey);
await fileStorage.writeFile(FileStorageScope.customerInvoices, storageKey, buffer);
```

## Path / object key layout

```
{scope-segment}/{storageKey}
```

| Scope                | Segment               | Example (local path / S3 key without prefix) |
| -------------------- | --------------------- | -------------------------------------------- |
| `customerInvoices`   | `customer/invoices`   | `customer/invoices/sub-1/inv-1.pdf`          |
| `customerOffers`     | `customer/offers`     | `customer/offers/{userId}/{offerId}.pdf`     |
| `customerTimesheets` | `customer/timesheets` | `customer/timesheets/.../id-time-report.pdf` |
| `supplierInvoices`   | `supplier/invoices`   | `supplier/invoices/{id}.pdf`                 |
| `datevExports`       | `export/datev`        | `export/datev/default/2026/01/export.zip`    |

- **local:** `{FILE_STORAGE_ROOT}/{segment}/{storageKey}`
- **s3:** `{FILE_STORAGE_S3_KEY_PREFIX?/}{segment}/{storageKey}` in `FILE_STORAGE_S3_BUCKET` (segment is the full nested path relative to `FILE_STORAGE_ROOT`)

## Environment

| Variable                                | Default                         | Purpose                                                            |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| `FILE_STORAGE_PROVIDER`                 | `local`                         | Active provider: `local` or `s3`                                   |
| `FILE_STORAGE_ROOT`                     | `{cwd}/data` (compose: `/data`) | Canonical base directory (local provider)                          |
| `FILE_STORAGE_LEGACY_MIGRATION_ENABLED` | `true`                          | Startup copy from legacy Decabill env roots into previous segments |
| `FILE_STORAGE_LAYOUT_MIGRATION_ENABLED` | `true`                          | Startup copy previous flat segments into customer/supplier/export  |
| `FILE_STORAGE_LAYOUT_DUAL_READ_ENABLED` | `true`                          | Read fallback from previous segments when new path is missing      |
| `BILLING_INVOICE_PDF_STORAGE_PATH`      | _(unset)_                       | **Deprecated.** Migration source for old invoices root             |
| `BILLING_DATEV_EXPORT_STORAGE_PATH`     | _(unset)_                       | **Deprecated.** Migration source for old DATEV root                |

### S3-compatible provider (`FILE_STORAGE_PROVIDER=s3`)

Works with AWS S3, Cloudflare R2, Backblaze B2, Ceph RGW, MinIO, and other S3-compatible APIs. Credentials are read only when the provider performs I/O (lazy), so local deployments do not need these variables.

| Variable                            | Default      | Purpose                               |
| ----------------------------------- | ------------ | ------------------------------------- |
| `FILE_STORAGE_S3_BUCKET`            | _(required)_ | Bucket / container name               |
| `FILE_STORAGE_S3_ACCESS_KEY_ID`     | _(required)_ | Access key                            |
| `FILE_STORAGE_S3_SECRET_ACCESS_KEY` | _(required)_ | Secret key                            |
| `FILE_STORAGE_S3_REGION`            | `auto`       | Region                                |
| `FILE_STORAGE_S3_ENDPOINT`          | _(unset)_    | Custom endpoint (R2, MinIO, …)        |
| `FILE_STORAGE_S3_FORCE_PATH_STYLE`  | `false`      | Path-style addressing when needed     |
| `FILE_STORAGE_S3_KEY_PREFIX`        | _(unset)_    | Optional key prefix inside the bucket |
