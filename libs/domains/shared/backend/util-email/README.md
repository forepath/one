# shared-backend-util-email

Transport-only SMTP email via nodemailer, plus shared Handlebars template loading/rendering helpers for the notifications email channel.

## EmailService

- `send(options)` — returns `boolean` (false when SMTP disabled or send fails)
- `sendOrThrow(options)` — throws on failure so BullMQ workers can retry
- `isEnabled()` — whether `SMTP_HOST` / `SMTP_PORT` are configured

Content (subjects and bodies) is owned by `feature-notifications` / domain publishers. Do not add inline message helpers here.

## Templates

- `EmailTemplateLoader` — loads `{base}.template.html` / `{base}.template.txt`
- `EmailTemplateRendererService` — compiles Handlebars with `email-layout` partial
- `resolveEmailSubject` — resolves TypeScript subject registries

## Env

| Variable                      | Role               |
| ----------------------------- | ------------------ |
| `SMTP_HOST`                   | Required to enable |
| `SMTP_PORT`                   | Default `1025`     |
| `SMTP_USER` / `SMTP_PASSWORD` | Optional auth      |
| `EMAIL_FROM`                  | From address       |

Company header/footer branding is configured on `NotificationsModule` via `resolveEmailCompanyFrom()` (`EMAIL_COMPANY_*`, fallback `BILLING_ISSUER_*`) — not in this library.
