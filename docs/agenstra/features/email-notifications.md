# Email notifications (Agenstra)

Identity transactional emails (confirmation, password reset) are delivered asynchronously via BullMQ (`email-deliver` on the `agent-controller` queue).

## Transport

- **Library:** nodemailer (`EmailService`)
- **SMTP env:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`
- When SMTP is disabled, enqueue is skipped.

### Company header and footer

Prefer `EMAIL_COMPANY_*` (see agent-controller `.start-containers.env.example`). Each field falls back to the matching `BILLING_ISSUER_*` if set (useful when Agenstra shares issuer config with Decabill).

| Variable                      | Fallback                       |
| ----------------------------- | ------------------------------ |
| `EMAIL_COMPANY_NAME`          | `BILLING_ISSUER_NAME`          |
| `EMAIL_COMPANY_ADDRESS_LINE1` | `BILLING_ISSUER_ADDRESS_LINE1` |
| `EMAIL_COMPANY_POSTAL_CODE`   | `BILLING_ISSUER_POSTAL_CODE`   |
| `EMAIL_COMPANY_CITY`          | `BILLING_ISSUER_CITY`          |
| `EMAIL_COMPANY_COUNTRY`       | `BILLING_ISSUER_COUNTRY`       |
| `EMAIL_COMPANY_VAT_ID`        | `BILLING_ISSUER_VAT_ID`        |
| `EMAIL_COMPANY_EMAIL`         | `BILLING_ISSUER_EMAIL`         |

If no company name is resolved, header and footer are omitted.

## Wiring

- `AgenstraNotificationsModule` registers the email channel with identity templates and subjects
- `IdentityEmailBridgeModule` provides `IDENTITY_EMAIL_DISPATCHER` for `UsersService` / `AuthService`
- Worker: `ControllerJobsProcessor` handles `email-deliver`

## Templates

- Location: `feature-notifications/src/lib/templates/`
- Files: `{name}.template.html` + `{name}.template.txt`
- Subjects: `IDENTITY_EMAIL_SUBJECTS` in TypeScript
- Style: neutral invoice-aligned layout partial (`email-layout.partial.html`); no sign-offs

## Events

| Event                               | Template             |
| ----------------------------------- | -------------------- |
| `user.email_confirmation_requested` | `email-confirmation` |
| `user.password_reset_requested`     | `password-reset`     |

Operational Agenstra events (`client.*`, `ticket.*`, etc.) remain webhook/realtime only.
