import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
} from '@forepath/loadweaver/shared/util-pki';

import {
  certificateId,
  covers,
  nextAttempt,
  pickCertificate,
  renewalDue,
  validateUploadedCertificate,
} from './certificates.utils';

const now = new Date('2026-07-01T00:00:00Z');
const day = 86_400_000;
const cert = (id: string, names: string[], source: 'acme' | 'custom', days: number) => ({
  id,
  names,
  source,
  certificatePem: 'PEM',
  notAfter: new Date(now.getTime() + days * day),
});

describe('certificates', () => {
  it('derives readable ids', () => {
    expect(certificateId('www.example.com')).toBe('www-example-com');
    expect(certificateId('*.example.com')).toBe('wildcard-example-com');
    expect(certificateId(`${'a'.repeat(60)}.example.com`)).toHaveLength(64);
  });

  it('matches wildcards for exactly one label', () => {
    expect(covers('*.example.com', 'www.example.com')).toBe(true);
    expect(covers('*.example.com', 'a.b.example.com')).toBe(false);
    expect(covers('*.example.com', 'example.com')).toBe(false);
    expect(covers('www.example.com', 'www.example.com')).toBe(true);
  });

  it('prefers uploaded, then exact, then the longest valid certificate', () => {
    const certs = [
      cert('a', ['*.example.com'], 'acme', 80),
      cert('b', ['www.example.com'], 'acme', 60),
      cert('c', ['www.example.com'], 'acme', -1),
    ];

    expect(pickCertificate('www.example.com', certs, now)?.id).toBe('b');
    expect(pickCertificate('www.example.com', [...certs, cert('d', ['*.example.com'], 'custom', 10)], now)?.id).toBe(
      'd',
    );
    expect(pickCertificate('api.example.com', certs, now)?.id).toBe('a');
    expect(pickCertificate('example.org', certs, now)).toBeUndefined();
  });

  it('renews within 30 days and backs off exponentially', () => {
    expect(renewalDue(cert('a', [], 'acme', 31), now)).toBe(false);
    expect(renewalDue(cert('a', [], 'acme', 29), now)).toBe(true);
    expect(renewalDue(undefined, now)).toBe(true);
    expect(nextAttempt(1, now).getTime() - now.getTime()).toBe(5 * 60_000);
    expect(nextAttempt(3, now).getTime() - now.getTime()).toBe(20 * 60_000);
    expect(nextAttempt(30, now).getTime() - now.getTime()).toBe(day);
  });

  it('validates uploads: matching key, names, not expired', async () => {
    const ca = await createCertificateAuthority({ commonName: 'x', validityDays: 1 });
    const keys = await generateKeyPair();
    const other = await generateKeyPair();
    const issued = await issueCertificate({
      ca,
      csrPem: await createCsr(keys, 'x'),
      clusterId: 'c',
      kind: 'client',
      name: 'x',
      dnsNames: ['www.example.com'],
      validityHours: 2,
    });

    expect(validateUploadedCertificate(issued.certificatePem, keys.privateKeyPem, new Date())).toMatchObject({
      names: ['www.example.com'],
    });
    expect(() => validateUploadedCertificate(issued.certificatePem, other.privateKeyPem, new Date())).toThrow(
      'does not belong',
    );
    expect(() =>
      validateUploadedCertificate(issued.certificatePem, keys.privateKeyPem, new Date(Date.now() + 3 * 3_600_000)),
    ).toThrow('expired');
    expect(() => validateUploadedCertificate('nope', keys.privateKeyPem, new Date())).toThrow('valid PEM certificate');
  });
});
