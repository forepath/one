# Email notifications (Decabill)

Transactional customer emails are delivered asynchronously via BullMQ (`email-deliver` on the `billing` queue), using the same retry pattern as outbound webhooks.

## Transport

- **Library:** nodemailer (`EmailService` in `@forepath/shared/backend`)
- **SMTP env:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`
- When SMTP is disabled, enqueue is skipped (no job).

### Company header and footer

Brand block in the shared email layout. Prefer `EMAIL_COMPANY_*`; each field falls back to the matching `BILLING_ISSUER_*` value.

| Variable                      | Fallback                       |
| ----------------------------- | ------------------------------ |
| `EMAIL_COMPANY_NAME`          | `BILLING_ISSUER_NAME`          |
| `EMAIL_COMPANY_ADDRESS_LINE1` | `BILLING_ISSUER_ADDRESS_LINE1` |
| `EMAIL_COMPANY_POSTAL_CODE`   | `BILLING_ISSUER_POSTAL_CODE`   |
| `EMAIL_COMPANY_CITY`          | `BILLING_ISSUER_CITY`          |
| `EMAIL_COMPANY_COUNTRY`       | `BILLING_ISSUER_COUNTRY`       |
| `EMAIL_COMPANY_VAT_ID`        | `BILLING_ISSUER_VAT_ID`        |
| `EMAIL_COMPANY_EMAIL`         | `BILLING_ISSUER_EMAIL`         |

If no company name is resolved, header and footer are omitted. On Decabill, leaving `EMAIL_COMPANY_*` empty and configuring `BILLING_ISSUER_*` is enough.

## Templates

- Bodies: Handlebars `{name}.template.html` + `{name}.template.txt` under `feature-billing-manager/src/lib/templates/` (and identity templates from `feature-notifications`)
- Subjects: TypeScript registry in `billing-email-subject.constants.ts`
- Visual style: neutral invoice-aligned palette (same CSS tokens as `invoice-pdf.template.html`); no sign-offs

## Event catalog (implemented)

| Event                               | Template                        | Trigger                              |
| ----------------------------------- | ------------------------------- | ------------------------------------ |
| `invoice.issued`                    | `invoice-issued`                | Invoice issuance / project billing   |
| `invoice.voided`                    | `invoice-voided`                | Invoice void                         |
| `invoice.partial_credit_issued`     | `invoice-partial-credit`        | Statutory withdrawal credit          |
| `subscription.renewal_reminder`     | `subscription-renewal-reminder` | Renewal reminder job                 |
| `withdrawal.confirmation_requested` | `withdrawal-confirmation`       | Public withdrawal OTP                |
| `payment.succeeded`                 | `payment-succeeded`             | Payment webhook success              |
| `payment.failed`                    | `payment-failed`                | Payment webhook failure              |
| `subscription.canceled`             | `subscription-canceled`         | Cancel subscription                  |
| `user.email_confirmation_requested` | `email-confirmation`            | Identity registration / email change |
| `user.password_reset_requested`     | `password-reset`                | Password reset                       |

## Delivery & retries

- Job: `email-deliver`, max **3** attempts, exponential backoff from 5s
- Attachments: storage keys only in the job payload; PDFs loaded in the worker via `EMAIL_ATTACHMENT_RESOLVER` (BillingModule; resolved across module boundaries at delivery time)
- Audit: `email_deliveries` rows per attempt; `recipient`, `template_context`, and `error_message` encrypted with AES-256-GCM (`ENCRYPTION_KEY`)
- OTP/reset codes are stripped from persisted `template_context`

## Future (webhook-only today)

`payment.initiated`, `invoice.created`, `invoice.overdue`, `subscription.created/updated`, project/milestone/ticket/time_entry CRUD, `datev_export.*`
