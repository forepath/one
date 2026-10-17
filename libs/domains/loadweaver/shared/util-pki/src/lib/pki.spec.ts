import 'reflect-metadata';

import * as x509 from '@peculiar/x509';

import {
  createCertificateAuthority,
  createCsr,
  createServerCsr,
  generateKeyPair,
  identityUri,
  issueCertificate,
  parseIdentityUri,
  remainingLifetimeFraction,
  verifyCertificate,
} from './pki';

describe('pki', () => {
  let ca: Awaited<ReturnType<typeof createCertificateAuthority>>;

  beforeAll(async () => {
    ca = await createCertificateAuthority({ commonName: 'loadweaver test CA', validityDays: 365 });
  });

  it('issues a node certificate whose identity comes from the issuer, not the CSR', async () => {
    const keys = await generateKeyPair();
    const csr = await createCsr(keys, 'node:somebody-else');
    const issued = await issueCertificate({
      ca,
      csrPem: csr,
      clusterId: 'prod',
      kind: 'node',
      name: 'n1',
      validityHours: 24,
    });
    const verified = await verifyCertificate(issued.certificatePem, ca.certificatePem);

    expect(verified).toMatchObject({
      identity: 'spiffe://prod.loadweaver/node/n1',
      kind: 'node',
      name: 'n1',
      clusterId: 'prod',
    });
    expect(verified?.serialNumber.toLowerCase()).toBe(issued.serialNumber);
    expect(verified?.fingerprintSha256).toBe(issued.fingerprintSha256);
  });

  it('rejects certificates of another CA, expired ones and garbage', async () => {
    const other = await createCertificateAuthority({ commonName: 'other', validityDays: 1 });
    const keys = await generateKeyPair();
    const issued = await issueCertificate({
      ca: other,
      csrPem: await createCsr(keys, 'x'),
      clusterId: 'prod',
      kind: 'node',
      name: 'n1',
      validityHours: 1,
    });

    expect(await verifyCertificate(issued.certificatePem, ca.certificatePem)).toBeNull();
    expect(
      await verifyCertificate(issued.certificatePem, other.certificatePem, new Date(Date.now() + 2 * 3_600_000)),
    ).toBeNull();
    expect(await verifyCertificate('not a cert', ca.certificatePem)).toBeNull();
  });

  it('caps the lifetime at the CA expiry and reports the remaining fraction', async () => {
    const shortCa = await createCertificateAuthority({ commonName: 'short', validityDays: 1 });
    const issued = await issueCertificate({
      ca: shortCa,
      csrPem: await createCsr(await generateKeyPair(), 'x'),
      clusterId: 'c',
      kind: 'node',
      name: 'n',
      validityHours: 1000,
    });

    expect(issued.notAfter.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000 + 1000);
    expect(remainingLifetimeFraction(issued.certificatePem)).toBeGreaterThan(0.9);
    expect(remainingLifetimeFraction(issued.certificatePem, new Date(Date.now() + 2 * 86_400_000))).toBe(0);
  });

  it('rejects tampered CSRs', async () => {
    const csr = await createCsr(await generateKeyPair(), 'x');
    const lines = csr.split('\n');
    const body = lines[3];

    lines[3] = body.slice(0, 10) + (body[10] === 'A' ? 'B' : 'A') + body.slice(11);

    await expect(
      issueCertificate({ ca, csrPem: lines.join('\n'), clusterId: 'c', kind: 'node', name: 'n', validityHours: 1 }),
    ).rejects.toThrow();
  });

  it('validates identity URIs strictly', () => {
    expect(identityUri('c1', 'workload', 'shop/api')).toBe('spiffe://c1.loadweaver/workload/shop/api');
    expect(() => identityUri('C1', 'node', 'n')).toThrow();
    expect(() => identityUri('c1', 'node', '../etc')).toThrow();
    expect(() => identityUri('c1', 'node', 'a//b')).toThrow();
    expect(parseIdentityUri('spiffe://c1.loadweaver/node/n1')).toEqual({ clusterId: 'c1', kind: 'node', name: 'n1' });
    expect(parseIdentityUri('spiffe://c1.loadweaver/admin/n1')).toBeNull();
    expect(parseIdentityUri('https://c1.loadweaver/node/n1')).toBeNull();
  });
});

describe('createServerCsr', () => {
  it('puts every DNS name into the subject alternative names', async () => {
    const csr = await createServerCsr(await generateKeyPair(), ['www.example.com', 'example.com']);
    const parsed = new x509.Pkcs10CertificateRequest(csr.pem);
    const san = parsed.extensions.find(
      (e): e is x509.SubjectAlternativeNameExtension => e instanceof x509.SubjectAlternativeNameExtension,
    );

    expect(parsed.subject).toBe('CN=www.example.com');
    expect(san?.names.items.map((n) => n.value)).toEqual(['www.example.com', 'example.com']);
    expect(csr.der.length).toBeGreaterThan(100);
  });
});
