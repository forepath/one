import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookSignatureParts {
  timestamp: number;
  signature: string;
}

export class WebhookSignatureService {
  sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signedPayload = `${timestamp}.${payload}`;
    const digest = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

    return `t=${timestamp},v1=${digest}`;
  }

  parse(header: string): WebhookSignatureParts | null {
    const parts = header.split(',').map((part) => part.trim());
    let timestamp: number | undefined;
    let signature: string | undefined;

    for (const part of parts) {
      const [key, value] = part.split('=');

      if (key === 't') {
        timestamp = Number.parseInt(value ?? '', 10);
      }

      if (key === 'v1') {
        signature = value;
      }
    }

    if (!timestamp || !signature) {
      return null;
    }

    return { timestamp, signature };
  }

  verify(payload: string, secret: string, header: string, toleranceSeconds = 300): boolean {
    const parsed = this.parse(header);

    if (!parsed) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);

    if (Math.abs(now - parsed.timestamp) > toleranceSeconds) {
      return false;
    }

    const expected = createHmac('sha256', secret).update(`${parsed.timestamp}.${payload}`, 'utf8').digest('hex');
    const actual = parsed.signature;

    if (expected.length !== actual.length) {
      return false;
    }

    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'));
  }
}
