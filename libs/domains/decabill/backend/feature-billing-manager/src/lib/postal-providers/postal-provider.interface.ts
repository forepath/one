import type { PostalLetterStatus } from '../constants/postal-letter.constants';
import type { PostalAddressPosition } from '../constants/postal-provider.constants';

/** Recipient as printed in the address window (already validated and normalized). */
export interface PostalLetterRecipient {
  /** Name lines (company, contact person). */
  nameLines: string[];
  /** Street lines (street + number, optional second line). */
  streetLines: string[];
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

export interface SendPostalLetterParams {
  /** Print-ready PDF (A4; the recipient address in the window position given below). */
  pdf: Buffer;
  /** File name shown at the provider (no path). */
  fileName: string;
  addressPosition: PostalAddressPosition;
  recipient: PostalLetterRecipient;
  /**
   * Stable per delivery (document + claim): retries of the same delivery must not create a second letter at the
   * provider, also when an earlier attempt was accepted but its response got lost.
   */
  idempotencyKey: string;
}

export interface SendPostalLetterResult {
  /** The provider's letter id (webhooks reference it). */
  externalId: string;
  status: PostalLetterStatus;
  pageCount?: number | null;
}

/** A provider webhook event mapped onto the normalized letter lifecycle. */
export interface PostalLetterWebhookEvent {
  externalLetterId: string;
  status: PostalLetterStatus;
  /** Provider's reason (issues, undeliverable), plain text. */
  reason?: string | null;
}

/**
 * Postal provider that prints and posts documents as physical letters (`BILLING_DEFAULT_POSTAL_PROVIDER`, built-in:
 * Pingen; more via `DYNAMIC_POSTAL_PROVIDERS`). Configuration is read per call inside the tenant context, so each
 * tenant may use its own provider account.
 */
export interface PostalProvider {
  getType(): string;
  getDisplayName(): string;
  /** Whether the provider has the credentials it needs in the current tenant context. */
  isConfigured(): boolean;
  /** Whether letters are printed on both sides (a cover page then gets an empty back side). */
  printsDuplex(): boolean;
  /**
   * Whether the provider prints its own postage and sender block above the address (the cover page then leaves that
   * zone empty: no return-address line). Default `false`.
   */
  printsSenderBlock?(): boolean;
  sendLetter(params: SendPostalLetterParams): Promise<SendPostalLetterResult>;
  /** Request header carrying the webhook signature (lower case). */
  getWebhookSignatureHeader(): string;
  /**
   * Provider letter id referenced by an (unverified) webhook body, used only to resolve the letter and its tenant;
   * `null` when the body does not reference a letter.
   */
  extractWebhookLetterId(rawBody: string): string | null;
  /** Verifies the webhook signature with the current tenant's signing key (constant time). */
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean;
  /** Maps a verified webhook body onto the letter lifecycle; `null` for events that do not change it. */
  parseWebhookEvent(rawBody: string): PostalLetterWebhookEvent | null;
}

/**
 * Provider failure. `retryable` marks transient problems (network, rate limit, provider outage); everything else
 * (rejected credentials, invalid document) needs an admin.
 */
export class PostalProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PostalProviderError';
  }
}
