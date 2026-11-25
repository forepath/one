import { createHmac } from 'node:crypto';

import { PingenError } from 'pingen2-sdk-js';

import { PostalLetterStatus } from '../../constants/postal-letter.constants';
import { PostalProviderError } from '../postal-provider.interface';

import { describePingenError, isRetryablePingenError, PingenPostalProvider } from './pingen-postal.provider';

const LETTER_ID = '0b5a3a8e-7d0d-4d5b-9a51-2f0a3c1d9e11';
const ORG_ID = '8f9c2b8e-1d43-4f6e-9a1b-3b5d1c2e7f00';
const SIGNING_KEY = 'abcdefghijklmnopqrstuvwx';

function webhookBody(type: string, relationship = 'letter', reason?: string): string {
  return JSON.stringify({
    data: {
      id: 'evt-1',
      type,
      attributes: reason ? { reason, created_at: '2026-11-25T10:00:00+0100' } : {},
      relationships: {
        organisation: { data: { id: ORG_ID, type: 'organisations' } },
        [relationship]: { data: { id: LETTER_ID, type: 'letters' } },
      },
    },
  });
}

function sign(body: string, key = SIGNING_KEY): string {
  return createHmac('sha256', key).update(body).digest('hex');
}

describe('PingenPostalProvider', () => {
  const env = process.env;
  let provider: PingenPostalProvider;

  beforeEach(() => {
    process.env = { ...env };
    provider = new PingenPostalProvider();
  });

  afterAll(() => {
    process.env = env;
  });

  describe('configuration', () => {
    it('is configured only with client id, secret and a well-formed organisation id', () => {
      expect(provider.isConfigured()).toBe(false);

      process.env.PINGEN_CLIENT_ID = 'client';
      process.env.PINGEN_CLIENT_SECRET = 'secret';
      process.env.PINGEN_ORGANISATION_ID = '../../etc/passwd';
      expect(provider.isConfigured()).toBe(false);

      process.env.PINGEN_ORGANISATION_ID = ORG_ID;
      expect(provider.isConfigured()).toBe(true);
    });

    it('prints duplex only when configured', () => {
      expect(provider.printsDuplex()).toBe(false);
      process.env.PINGEN_PRINT_MODE = 'duplex';
      expect(provider.printsDuplex()).toBe(true);
      process.env.PINGEN_PRINT_MODE = 'triplex';
      expect(provider.printsDuplex()).toBe(false);
      // Pingen prints postage and sender above the address (protected_stamp_area).
      expect(provider.printsSenderBlock()).toBe(true);
    });

    it('refuses to send without configuration (not retryable)', async () => {
      await expect(
        provider.sendLetter({
          pdf: Buffer.from('%PDF'),
          fileName: 'x.pdf',
          addressPosition: 'left',
          recipient: { nameLines: ['A'], streetLines: ['B 1'], postalCode: '1', city: 'C', country: 'DE' },
          idempotencyKey: 'k',
        }),
      ).rejects.toEqual(expect.objectContaining({ retryable: false }));
    });
  });

  describe('webhooks', () => {
    it('extracts the letter id from letter or deliverable relationships and rejects malformed ids', () => {
      expect(provider.extractWebhookLetterId(webhookBody('webhook_sent'))).toBe(LETTER_ID);
      expect(provider.extractWebhookLetterId(webhookBody('webhook_issues', 'deliverable'))).toBe(LETTER_ID);
      expect(provider.extractWebhookLetterId('{"data":{"relationships":{"letter":{"data":{"id":"x OR 1=1"}}}}}')).toBe(
        null,
      );
      expect(provider.extractWebhookLetterId('not json')).toBeNull();
    });

    it('verifies the HMAC-SHA256 signature with the signing key (case-insensitive hex)', () => {
      const body = webhookBody('webhook_sent');

      expect(provider.verifyWebhookSignature(body, sign(body))).toBe(false);

      process.env.PINGEN_WEBHOOK_SIGNING_KEY = SIGNING_KEY;
      expect(provider.verifyWebhookSignature(body, sign(body))).toBe(true);
      expect(provider.verifyWebhookSignature(body, sign(body).toUpperCase())).toBe(true);
      expect(provider.verifyWebhookSignature(body, sign(body, 'another-key-another-key'))).toBe(false);
      expect(provider.verifyWebhookSignature(`${body} `, sign(body))).toBe(false);
      expect(provider.verifyWebhookSignature(body, undefined)).toBe(false);
      expect(provider.getWebhookSignatureHeader()).toBe('signature');
    });

    it.each([
      ['webhook_issues', PostalLetterStatus.ACTION_REQUIRED],
      ['webhook_sent', PostalLetterStatus.SENT],
      ['webhook_undeliverable', PostalLetterStatus.UNDELIVERABLE],
      ['webhook_delivered', PostalLetterStatus.DELIVERED],
    ])('maps %s onto %s', (type, status) => {
      expect(provider.parseWebhookEvent(webhookBody(type, 'letter', 'Content failed inspection'))).toEqual({
        externalLetterId: LETTER_ID,
        status,
        reason: 'Content failed inspection',
      });
    });

    it('ignores unknown event types and caps long reasons', () => {
      expect(provider.parseWebhookEvent(webhookBody('webhook_channel_subscriptions'))).toBeNull();
      expect(
        provider.parseWebhookEvent(webhookBody('webhook_issues', 'letter', 'x'.repeat(2000)))?.reason,
      ).toHaveLength(500);
    });
  });

  describe('errors', () => {
    it('describes Pingen errors without request data and classifies retries', () => {
      const unauthorized = new PingenError('auth', 401, { errors: [{ title: 'Unauthorized' }] });
      const invalid = new PingenError('bad', 422, { errors: [{ title: 'Validation', detail: 'file_url invalid' }] });
      const outage = new PingenError('down', 503);
      const networkStatus = new PingenError('network', 0);

      expect(describePingenError(unauthorized)).toMatch(/rejected the credentials/);
      expect(describePingenError(invalid)).toBe('Pingen request failed (status 422): Validation: file_url invalid');
      expect(isRetryablePingenError(unauthorized)).toBe(false);
      expect(isRetryablePingenError(invalid)).toBe(false);
      expect(isRetryablePingenError(outage)).toBe(true);
      expect(isRetryablePingenError(new PingenError('in progress', 409))).toBe(true);
      expect(isRetryablePingenError(networkStatus)).toBe(true);
      expect(isRetryablePingenError(new Error('fetch failed'))).toBe(true);
      expect(isRetryablePingenError(new PostalProviderError('config', false))).toBe(false);

      const refused = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' });
      const network = new PingenError(
        'Pingen API GET failed unexpectedly.',
        0,
        Object.assign(new TypeError('fetch failed'), { cause: refused }),
      );

      expect(describePingenError(network)).toBe(
        'Pingen could not be reached: fetch failed / ECONNREFUSED: connect ECONNREFUSED 10.0.0.1:443',
      );
    });
  });
});
