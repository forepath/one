# shared-backend-util-webhook

HTTP delivery client, HMAC signing (`Forepath-Signature`), and authentication helpers for outbound webhooks.

## Exports

- `WebhookHttpClient` — POST/GET delivery with auth headers or query params
- `WebhookSignatureService` — sign and verify payload signatures
- `applyWebhookAuth` / `assertWebhookAuthCompatible` — auth type validation and application

## Tests

`nx run shared-backend-util-webhook:test`
