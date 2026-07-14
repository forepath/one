import { applyWebhookAuth } from './webhook-auth-applicator';
import { validateWebhookUrlWithDnsOrThrow } from './webhook-endpoint-security';
import { truncateWebhookResponseBody } from './webhook-response.util';
import type { WebhookDeliveryRequest, WebhookDeliveryResult } from './webhook.types';

export {
  assertProductionWebhookEscapeHatchesDisabled,
  assertPublicHttpsWebhookUrl,
  assertSafeWebhookUrlOrThrow,
  assertWebhookHostnameResolvesToPublicIps,
  validateWebhookUrlWithDnsOrThrow,
} from './webhook-endpoint-security';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 0;

function flattenEnvelopeToQuery(body: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) {
      continue;
    }

    params[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  return params;
}

export class WebhookHttpClient {
  async deliver(request: WebhookDeliveryRequest): Promise<WebhookDeliveryResult> {
    await validateWebhookUrlWithDnsOrThrow(request.url);

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const applied = applyWebhookAuth(request.auth);
    const url = new URL(request.url);

    for (const [key, value] of Object.entries(applied.queryParams)) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Forepath-Webhooks/1.0',
      ...request.headers,
      ...applied.headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (request.method === 'GET') {
        if (request.body) {
          for (const [key, value] of Object.entries(flattenEnvelopeToQuery(request.body))) {
            url.searchParams.set(key, value);
          }
        }

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: controller.signal,
        });

        return await this.toResult(response);
      }

      headers['Content-Type'] = 'application/json';
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(request.body ?? {}),
        redirect: 'manual',
        signal: controller.signal,
      });

      return await this.toResult(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook delivery failed';

      return {
        httpStatus: null,
        responseBody: null,
        success: false,
        errorMessage: message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async toResult(response: Response): Promise<WebhookDeliveryResult> {
    if (response.status >= 300 && response.status < 400) {
      return {
        httpStatus: response.status,
        responseBody: null,
        success: false,
        errorMessage: `HTTP redirects are not allowed (received ${response.status})`,
      };
    }

    const responseBody = truncateWebhookResponseBody(await response.text());

    return {
      httpStatus: response.status,
      responseBody,
      success: response.ok,
      errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
    };
  }
}

/** @internal Exported for unit tests only. */
export const WEBHOOK_HTTP_CLIENT_MAX_REDIRECTS = MAX_REDIRECTS;
