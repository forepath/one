import { CORS_ALLOWED_HEADERS } from './cors';

describe('CORS headers', () => {
  it('allows every request header the console sets (else the browser drops the request after the preflight)', () => {
    const allowed = new Set(CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase()));

    // Drafts (`If-Match`), uploads, correlation ids, bundle uploads.
    for (const header of [
      'authorization',
      'content-type',
      'if-match',
      'x-correlation-id',
      'content-range',
      'x-upload-id',
      'x-loadweaver-content-sha256',
    ])
      expect(allowed.has(header)).toBe(true);
  });
});
