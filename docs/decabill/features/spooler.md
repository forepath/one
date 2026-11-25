# Spooler

Admin-triggered document sends and printouts run as tracked background jobs (BullMQ) instead of inside the console request. The console gets a job back right away, the worker does the work, and admins see every job of the tenant on the **Spooler** page with its status, error, file, retry and cancel.

## What is spooled

| Kind                        | Triggered by                                                                                       | Output                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `document.send`             | Sending an unsent invoice, credit note or offer by email or as a letter (admin send actions)       | Email to the customer, or a letter at the postal provider |
| `print.inventory_labels`    | Printing inventory labels / property stickers in the console                                       | PDF kept for download                                     |
| `print.inventory_movement`  | Downloading an inventory movement document (putaway, transfer, withdrawal, lending) in the console | PDF kept for download                                     |
| `print.project_time_report` | Generating a project time report in the console                                                    | PDF kept for download                                     |

Not spooled:

- **Customer downloads** (invoice, credit note and offer PDFs in the customer's account) stay instant.
- **Emails sent while finalizing** (issuing, voiding, archiving or billing project time with "notify customer" on) and automatic emails (billing run, offer acceptance) are sent as before.
- **Mark as sent** records a manual delivery right away; nothing is sent.

The synchronous printout endpoints stay available for API clients: `POST /admin/billing/inventory/labels`, `GET /admin/billing/inventory/movements/{id}/pdf` and `POST /admin/billing/projects/{projectId}/time-report` still return the PDF in the response.

## Spooling endpoints

| Endpoint                                                              | Scope                               | Response                  |
| --------------------------------------------------------------------- | ----------------------------------- | ------------------------- |
| `POST /admin/billing/invoices/{invoiceRefId}/send`                    | `invoices:admin`                    | Invoice with `spoolJobId` |
| `POST /admin/billing/invoices/{invoiceRefId}/send-credit-note`        | `invoices:admin`                    | Invoice with `spoolJobId` |
| `POST /admin/billing/invoices/{invoiceRefId}/send-letter`             | `invoices:admin` + `letters:admin`  | Invoice with `spoolJobId` |
| `POST /admin/billing/invoices/{invoiceRefId}/send-credit-note-letter` | `invoices:admin` + `letters:admin`  | Invoice with `spoolJobId` |
| `POST /admin/billing/offers/{id}/send`                                | `offers:admin`                      | Offer with `spoolJobId`   |
| `POST /admin/billing/offers/{id}/send-letter`                         | `offers:admin` + `letters:admin`    | Offer with `spoolJobId`   |
| `POST /admin/billing/inventory/labels/spool`                          | `inventory:admin` + `spooler:admin` | `202` spool job           |
| `POST /admin/billing/inventory/movements/{id}/pdf/spool`              | `inventory:admin` + `spooler:admin` | `202` spool job           |
| `POST /admin/billing/projects/{projectId}/time-report/spool`          | `projects:admin` + `spooler:admin`  | `202` spool job           |

The request checks what it can before a job is created (the document can be sent on this channel, the movement or project exists in the tenant); the label content itself (nothing to print, too many labels, missing company name) is checked by the job, which then fails with that reason.

### Document sends

A send claims the document when the request runs: `sentAt` and `sentVia` (credit note: `voidDocumentSentAt` / `voidDocumentSentVia`) are set atomically, so the document counts as sent immediately, a second send on any channel is refused and concurrent requests send once. The job then emails the document or submits the letter, but only while the document is still claimed by it. When the job fails for good or is cancelled, the claim is released: the document shows as unsent again (with its to-do in the [Action Center](./action-center.md)) and can be sent another way. See [Invoices](./invoices.md#finalize-and-send), [Offers](./offers.md#finalize-and-send) and [Postal delivery](./postal-delivery.md).

## Job lifecycle

| Status       | Meaning                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `queued`     | Waiting for a worker, or for the next attempt after a transient failure (`error` shows the last reason) |
| `processing` | A worker is running it                                                                                  |
| `completed`  | Done; printouts have a file to download (`hasFile`)                                                     |
| `failed`     | Failed for good; `error` holds the reason. Document sends have released their document                  |
| `cancelled`  | Cancelled before it started. Document sends have released their document                                |

**Attempts.** Each job gets 3 attempts with exponential backoff (10 s, then 20 s). Transient errors (network, timeouts, rate limits, provider outages, HTTP 408 / 429 / 5xx) are retried; permanent errors end the job on the first attempt: 4xx-type rejections (for example "Customer has no billing email address", a letter rejected by the postal provider, invalid label input), a document that is no longer waiting for this delivery, or an output above 50 MB. Errors are stored with at most 500 characters.

**Retry** (`failed` only) queues the job again with a fresh budget of 3 attempts. A document send is retried only while the document is still unsent and the channel is still ready (billing email address, configured postal provider, complete postal address); it claims the document again for the new attempt. Otherwise the retry is refused (400) and the job stays failed.

**Cancel** (`queued` only) stops a job that has not started yet, including a job waiting for its next attempt. A running job cannot be cancelled.

## Coordinator and retention

The `spooler.coordinator` repeatable job (`SPOOLER_COORDINATOR_INTERVAL`, default 60 s, restart required) runs across tenants:

- re-enqueues jobs whose queue entry was lost: `queued` for more than 2 minutes, or `processing` for more than 15 minutes (crashed worker; BullMQ's stall detection usually catches these first)
- removes finished jobs (`completed`, `failed`, `cancelled`) and their files after `BILLING_SPOOLER_RETENTION_DAYS` (default `7`, `1` to `365`)

Unit jobs (`spooler.unit`) run in the worker inside the job's tenant. Files are stored in the database (`billing_spool_job_outputs`) and deleted with their job. See [Background Jobs](../deployment/background-jobs.md).

## Spooler page

The **Spooler** page in the administration lists the tenant's jobs, newest first, with counts per status. Completed printouts can be downloaded there, failed jobs retried and queued jobs cancelled.

Pages that print (labels, movement documents, time reports) spool the printout and download the file automatically once the job completed: the page polls the job (every second at first, then every 3 seconds) for up to 5 minutes. If the job takes longer, the page stops waiting and the file stays available on the Spooler page; a failed or cancelled printout shows its error.

Failed jobs appear in the action center as `decabill.spooler.failed` (Platform) until they are retried or removed by the retention.

## API

Base path `/admin/billing/spooler/jobs`, admins and managers, PAT scope `spooler:admin`:

| Endpoint            | Description                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /`             | List (`status`, `kind`, `documentType`, `documentId`, `limit` 1 to 100, default 25, `offset`) with `counts` |
| `GET /{id}`         | One job                                                                                                     |
| `GET /{id}/file`    | File of a completed printout (404 when there is none or it was removed)                                     |
| `POST /{id}/retry`  | Retry a failed job                                                                                          |
| `POST /{id}/cancel` | Cancel a queued job                                                                                         |

Job fields: `id`, `kind`, `status`, `outputTarget` (`download`, `email`, `postal`), `title`, `documentType`, `documentId`, `attempts`, `error`, `hasFile`, `fileName`, `fileSize`, `externalLetterId` (letters), `canRetry`, `canCancel`, `createdByUserId`, `createdAt`, `startedAt`, `finishedAt`.

Audit log entries: `spool_job.complete`, `spool_job.fail`, `spool_job.retry`, `spool_job.cancel` (with the invoice or offer reference for document sends).

Full schemas: [Billing Manager OpenAPI](/spec/billing-manager/openapi.yaml).

## Related documentation

- **[Invoices](./invoices.md)** and **[Offers](./offers.md)** Sending documents
- **[Postal delivery](./postal-delivery.md)** Letters through a postal provider
- **[Inventory](./inventory.md)** Labels and movement documents
- **[Projects](./projects.md)** Time reports
- **[Action Center](./action-center.md)** Failed spool jobs
- **[Background Jobs](../deployment/background-jobs.md)** Queue roles and coordinators
