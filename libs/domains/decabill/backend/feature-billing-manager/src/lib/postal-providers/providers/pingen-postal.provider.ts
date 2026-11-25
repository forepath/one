import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  ApiRequestor,
  buildJsonApi,
  FileUpload,
  OAuth,
  PingenError,
  verifyWebhookSignature,
  type LetterAttributes,
} from 'pingen2-sdk-js';

import { PostalLetterStatus, POSTAL_LETTER_REASON_MAX_LENGTH } from '../../constants/postal-letter.constants';
import {
  PINGEN_DELIVERY_PRODUCTS,
  PINGEN_PRINT_MODES,
  PINGEN_PRINT_SPECTRUMS,
} from '../../constants/postal-provider.constants';
import {
  PostalProviderError,
  type PostalLetterWebhookEvent,
  type PostalProvider,
  type SendPostalLetterParams,
  type SendPostalLetterResult,
} from '../postal-provider.interface';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Signed upload URLs are short-lived; the PDF is at most a few MB. */
const UPLOAD_TIMEOUT_MS = 60_000;
/** Bounded so that many tenants (or rotated credentials) cannot grow the token cache without limit. */
const MAX_CACHED_CLIENTS = 64;
/** Pingen webhook payload types (`data.type`) mapped onto the letter lifecycle. */
const WEBHOOK_STATUS_BY_TYPE: Record<string, PostalLetterStatus> = {
  webhook_issues: PostalLetterStatus.ACTION_REQUIRED,
  webhook_sent: PostalLetterStatus.SENT,
  webhook_dispatched: PostalLetterStatus.SENT,
  webhook_undeliverable: PostalLetterStatus.UNDELIVERABLE,
  webhook_delivered: PostalLetterStatus.DELIVERED,
};

interface PingenSettings {
  clientId: string;
  clientSecret: string;
  organisationId: string;
  useStaging: boolean;
}

interface PingenWebhookBody {
  data?: {
    type?: unknown;
    attributes?: { reason?: unknown };
    relationships?: Record<string, { data?: { id?: unknown; type?: unknown } } | undefined>;
  };
}

/**
 * Pingen (https://www.pingen.de/de/post-api/) through the official `pingen2-sdk-js`: OAuth client credentials, signed
 * upload of the PDF, letter creation with `auto_send` (Pingen validates, prints and posts it), status via webhooks
 * (`issues`, `sent`, `undeliverable`, `delivered`) signed with HMAC-SHA256 in the `Signature` header.
 *
 * All settings are tenant-scoped (`PINGEN_*`), read per call.
 */
@Injectable()
export class PingenPostalProvider implements PostalProvider {
  private readonly logger = new Logger(PingenPostalProvider.name);
  private readonly clients = new Map<string, OAuth>();

  getType(): string {
    return 'pingen';
  }

  getDisplayName(): string {
    return 'Pingen';
  }

  isConfigured(): boolean {
    return this.readSettings() !== null;
  }

  printsDuplex(): boolean {
    return this.printMode() === 'duplex';
  }

  /** Pingen reserves the zone above the address for its postage imprint and sender line (`protected_stamp_area`). */
  printsSenderBlock(): boolean {
    return true;
  }

  async sendLetter(params: SendPostalLetterParams): Promise<SendPostalLetterResult> {
    const settings = this.readSettings();

    if (!settings) {
      throw new PostalProviderError(
        'Pingen is not configured (PINGEN_CLIENT_ID, PINGEN_CLIENT_SECRET, PINGEN_ORGANISATION_ID)',
        false,
      );
    }

    const oauth = this.getOAuth(settings);

    try {
      const requestor = new ApiRequestor(await oauth.getAccessToken(), {
        useStaging: settings.useStaging,
        on401: async () => {
          oauth.invalidate();

          return await oauth.getAccessToken();
        },
      });
      const upload = await new FileUpload(requestor).requestFileUpload();

      await this.putFile(upload.url, params.pdf);

      // Posted through the requestor (not `Letters.create`) to send our own Idempotency-Key: Pingen replays the first
      // result for 24 h, so a retried delivery never creates a second letter.
      const response = await requestor.post(
        `/organisations/${settings.organisationId}/deliveries/letters`,
        buildJsonApi({
          type: 'letters',
          attributes: {
            file_original_name: params.fileName,
            file_url: upload.url,
            file_url_signature: upload.signature,
            address_position: params.addressPosition,
            auto_send: true,
            delivery_product: this.deliveryProduct(),
            print_mode: this.printMode(),
            print_spectrum: this.printSpectrum(),
          },
        }),
        { 'Idempotency-Key': params.idempotencyKey },
      );
      const letter = response.toResource<LetterAttributes>();

      if (!letter.id) {
        throw new Error('Pingen did not return a letter id');
      }

      return {
        externalId: letter.id,
        status: PostalLetterStatus.SUBMITTED,
        pageCount: typeof letter.attributes?.file_pages === 'number' ? letter.attributes.file_pages : null,
      };
    } catch (error) {
      throw new PostalProviderError(describePingenError(error), isRetryablePingenError(error));
    }
  }

  getWebhookSignatureHeader(): string {
    return 'signature';
  }

  extractWebhookLetterId(rawBody: string): string | null {
    const relationships = parseWebhookBody(rawBody)?.data?.relationships;
    const id = relationships?.['letter']?.data?.id ?? relationships?.['deliverable']?.data?.id;

    return typeof id === 'string' && UUID_PATTERN.test(id) ? id : null;
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    const signingKey = process.env.PINGEN_WEBHOOK_SIGNING_KEY?.trim();

    if (!signingKey || !signature) {
      return false;
    }

    try {
      verifyWebhookSignature(rawBody, signature.trim().toLowerCase(), signingKey);

      return true;
    } catch {
      return false;
    }
  }

  parseWebhookEvent(rawBody: string): PostalLetterWebhookEvent | null {
    const data = parseWebhookBody(rawBody)?.data;
    const status = typeof data?.type === 'string' ? WEBHOOK_STATUS_BY_TYPE[data.type] : undefined;
    const externalLetterId = this.extractWebhookLetterId(rawBody);

    if (!status || !externalLetterId) {
      return null;
    }

    const reason = typeof data?.attributes?.reason === 'string' ? data.attributes.reason.trim() : '';

    return {
      externalLetterId,
      status,
      reason: reason ? reason.slice(0, POSTAL_LETTER_REASON_MAX_LENGTH) : null,
    };
  }

  private readSettings(): PingenSettings | null {
    const clientId = process.env.PINGEN_CLIENT_ID?.trim();
    const clientSecret = process.env.PINGEN_CLIENT_SECRET?.trim();
    const organisationId = process.env.PINGEN_ORGANISATION_ID?.trim();

    // The organisation id is part of every API path: only well-formed UUIDs are used.
    if (!clientId || !clientSecret || !organisationId || !UUID_PATTERN.test(organisationId)) {
      return null;
    }

    return {
      clientId,
      clientSecret,
      organisationId,
      useStaging: process.env.PINGEN_ENVIRONMENT?.trim().toLowerCase() === 'staging',
    };
  }

  /** One OAuth client (with its cached 12 h access token) per credential set and environment. */
  private getOAuth(settings: PingenSettings): OAuth {
    const key = createHash('sha256')
      .update(`${settings.useStaging ? 'staging' : 'production'}\n${settings.clientId}\n${settings.clientSecret}`)
      .digest('hex');
    const cached = this.clients.get(key);

    if (cached) {
      return cached;
    }

    if (this.clients.size >= MAX_CACHED_CLIENTS) {
      const oldest = this.clients.keys().next().value;

      if (oldest !== undefined) {
        this.clients.delete(oldest);
      }
    }

    const oauth = new OAuth({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      useStaging: settings.useStaging,
    });

    this.clients.set(key, oauth);

    return oauth;
  }

  /** PUT of the raw PDF to the signed upload URL (no authorization header, as Pingen requires). */
  private async putFile(url: string, pdf: Buffer): Promise<void> {
    if (!url.startsWith('https://')) {
      throw new Error('Pingen returned a non-HTTPS upload URL');
    }

    const response = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(pdf),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`PDF upload to Pingen failed (status ${response.status})`);
    }
  }

  private deliveryProduct(): string {
    return oneOf(process.env.PINGEN_DELIVERY_PRODUCT, PINGEN_DELIVERY_PRODUCTS, 'cheap');
  }

  private printMode(): string {
    return oneOf(process.env.PINGEN_PRINT_MODE, PINGEN_PRINT_MODES, 'simplex');
  }

  private printSpectrum(): string {
    return oneOf(process.env.PINGEN_PRINT_SPECTRUM, PINGEN_PRINT_SPECTRUMS, 'grayscale');
  }
}

function oneOf(value: string | undefined, allowed: readonly string[], fallback: string): string {
  const normalized = value?.trim().toLowerCase();

  return normalized && allowed.includes(normalized) ? normalized : fallback;
}

function parseWebhookBody(rawBody: string): PingenWebhookBody | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;

    return parsed && typeof parsed === 'object' ? (parsed as PingenWebhookBody) : null;
  } catch {
    return null;
  }
}

/**
 * Error text for admins and logs: HTTP status and Pingen's error titles / details (JSON:API `errors`), never request
 * data or credentials.
 */
export function describePingenError(error: unknown): string {
  if (error instanceof PingenError) {
    const body = error.body as { errors?: Array<{ title?: unknown; detail?: unknown }> } | undefined;
    const details = (Array.isArray(body?.errors) ? body.errors : [])
      .map((entry) => [entry.title, entry.detail].filter((part) => typeof part === 'string' && part).join(': '))
      .filter(Boolean)
      .slice(0, 3)
      .join('; ');

    if (error.status === 401 || error.status === 403) {
      return `Pingen rejected the credentials (status ${error.status}); check PINGEN_CLIENT_ID, PINGEN_CLIENT_SECRET, PINGEN_ORGANISATION_ID and PINGEN_ENVIRONMENT (staging and production use separate accounts)`;
    }

    if (error.status === 0) {
      // Network level (DNS, TLS, connection reset, timeout): the SDK keeps the original error as body.
      return `Pingen could not be reached: ${describeNetworkCause(error.body) ?? error.message}`;
    }

    return `Pingen request failed (status ${error.status})${details ? `: ${details.slice(0, 300)}` : ''}`;
  }

  return error instanceof Error ? error.message.slice(0, 300) : 'Pingen request failed';
}

/** Network failures, timeouts, rate limits and server errors are worth retrying; 4xx answers are not. */
export function isRetryablePingenError(error: unknown): boolean {
  if (error instanceof PingenError) {
    // 409: a request with the same idempotency key is still running; the retry gets its result.
    return (
      error.status === 0 || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500
    );
  }

  // Upload / fetch failures (network, timeout) and unexpected responses.
  return !(error instanceof PostalProviderError) || error.retryable;
}

/** Short network error cause (error code and message of the fetch failure), never request data. */
function describeNetworkCause(cause: unknown): string | null {
  const parts: string[] = [];
  let current: unknown = cause;

  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    const code = (current as Error & { code?: unknown }).code;

    parts.push(typeof code === 'string' ? `${code}: ${current.message}` : current.message);
    current = (current as Error & { cause?: unknown }).cause;
  }

  return parts.length > 0 ? parts.join(' / ').slice(0, 300) : null;
}
