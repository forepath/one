export const WEBHOOK_MAX_RESPONSE_BODY_CHARS = 8_192;

export function truncateWebhookResponseBody(body: string | null | undefined): string | null {
  if (body == null) {
    return null;
  }

  if (body.length <= WEBHOOK_MAX_RESPONSE_BODY_CHARS) {
    return body;
  }

  return `${body.slice(0, WEBHOOK_MAX_RESPONSE_BODY_CHARS)}…[truncated]`;
}
