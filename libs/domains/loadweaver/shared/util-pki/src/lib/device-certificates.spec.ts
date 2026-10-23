import 'reflect-metadata';

import { webcrypto } from 'node:crypto';

import * as x509 from '@peculiar/x509';

import { caBundleIssues, verifyDeviceCertificate, verifyPossession } from './device-certificates';
import { createCertificateAuthority, createCsr, generateKeyPair, issueCertificate } from './pki';

const crypto = webcrypto as unknown as Crypto;
const NOW = new Date('2026-10-20T12:00:00Z');
const EC = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;

async function setup() {
  const ca = await createCertificateAuthority({ commonName: 'Example Corp Device CA', validityDays: 365, now: NOW });
  const other = await createCertificateAuthority({ commonName: 'Other CA', validityDays: 365, now: NOW });
  const keys = await generateKeyPair();
  const issued = await issueCertificate({
    ca,
    csrPem: await createCsr(keys, 'laptop'),
    clusterId: 'corp',
    kind: 'client',
    name: '0b8f7c38-4c55-4a52-9f3e-6a0d1fd4a001',
    validityHours: 24 * 30,
    now: NOW,
  });

  return { ca, other, keys, issued };
}

async function crl(caPem: string, caKeyPem: string, serials: string[], nextUpdate: Date): Promise<string> {
  const caCert = new x509.X509Certificate(caPem);
  const key = await crypto.subtle.importKey('pkcs8', x509.PemConverter.decode(caKeyPem)[0], EC, false, ['sign']);
  const list = await x509.X509CrlGenerator.create({
    issuer: caCert.subject,
    thisUpdate: new Date(NOW.getTime() - 3_600_000),
    nextUpdate,
    signingAlgorithm: EC,
    signingKey: key,
    entries: serials.map((serialNumber) => ({ serialNumber, revocationDate: NOW })),
  });

  return list.toString('pem');
}

describe('device certificates', () => {
  it('accepts a certificate from the trusted CA and reports its facts', async () => {
    const { ca, issued } = await setup();
    const check = await verifyDeviceCertificate({
      certificatePem: issued.certificatePem,
      trustBundlePem: ca.certificatePem,
      now: NOW,
    });

    expect(check.valid).toBe(true);
    expect(check.reasons).toEqual([]);
    expect(check.serialNumber).toBe(issued.serialNumber);
    expect(check.uris).toEqual([issued.identity]);
    expect(check.notAfter?.getTime()).toBe(issued.notAfter.getTime());
  });

  it('rejects untrusted, expired and garbage certificates', async () => {
    const { other, issued } = await setup();

    expect(
      (
        await verifyDeviceCertificate({
          certificatePem: issued.certificatePem,
          trustBundlePem: other.certificatePem,
          now: NOW,
        })
      ).reasons,
    ).toEqual(['the device certificate is not issued by a trusted CA']);

    const later = new Date(NOW.getTime() + 40 * 86_400_000);
    const expired = await verifyDeviceCertificate({
      certificatePem: issued.certificatePem,
      trustBundlePem: `${other.certificatePem}\n${(await setup()).ca.certificatePem}`,
      now: later,
    });

    expect(expired.valid).toBe(false);
    expect(expired.reasons[0]).toMatch(/expired/);
    expect(
      (await verifyDeviceCertificate({ certificatePem: 'nope', trustBundlePem: other.certificatePem })).valid,
    ).toBe(false);
  });

  it('checks revocation with the issuer CRL and fails closed on outdated CRLs', async () => {
    const { ca, issued } = await setup();
    const revoked = await verifyDeviceCertificate({
      certificatePem: issued.certificatePem,
      trustBundlePem: ca.certificatePem,
      crlPem: await crl(
        ca.certificatePem,
        ca.privateKeyPem,
        [issued.serialNumber],
        new Date(NOW.getTime() + 86_400_000),
      ),
      now: NOW,
    });

    expect(revoked.revoked).toBe(true);
    expect(revoked.valid).toBe(false);

    const outdated = await verifyDeviceCertificate({
      certificatePem: issued.certificatePem,
      trustBundlePem: ca.certificatePem,
      crlPem: await crl(ca.certificatePem, ca.privateKeyPem, [], new Date(NOW.getTime() - 60_000)),
      now: NOW,
    });

    expect(outdated.revoked).toBe(false);
    expect(outdated.reasons[0]).toMatch(/outdated/);

    const clean = await verifyDeviceCertificate({
      certificatePem: issued.certificatePem,
      trustBundlePem: ca.certificatePem,
      crlPem: await crl(ca.certificatePem, ca.privateKeyPem, ['0abc'], new Date(NOW.getTime() + 86_400_000)),
      now: NOW,
    });

    expect(clean.valid).toBe(true);
  });

  it('verifies a proof of possession (raw and DER ECDSA signatures)', async () => {
    const { keys, issued } = await setup();
    const key = await crypto.subtle.importKey('pkcs8', x509.PemConverter.decode(keys.privateKeyPem)[0], EC, false, [
      'sign',
    ]);
    const message = 'loadweaver-posture-v1:c1:2026-10-20T12:00:00Z';
    const raw = await crypto.subtle.sign(EC, key, new TextEncoder().encode(message));
    const der = new x509.AsnEcSignatureFormatter().toAsnSignature(EC, raw) as ArrayBuffer;

    expect(await verifyPossession(issued.certificatePem, message, Buffer.from(raw).toString('base64'))).toBe(true);
    expect(await verifyPossession(issued.certificatePem, message, Buffer.from(der).toString('base64'))).toBe(true);
    expect(await verifyPossession(issued.certificatePem, `${message}x`, Buffer.from(raw).toString('base64'))).toBe(
      false,
    );
    expect(await verifyPossession(issued.certificatePem, message, 'AAAA')).toBe(false);
  });

  it('requires keyUsage digitalSignature and, when an EKU is present, clientAuth (company CA leaves)', async () => {
    const { ca } = await setup();
    const caCert = new x509.X509Certificate(ca.certificatePem);
    const signingKey = await crypto.subtle.importKey(
      'pkcs8',
      x509.PemConverter.decode(ca.privateKeyPem)[0],
      EC,
      false,
      ['sign'],
    );
    const leafKeys = await crypto.subtle.generateKey(EC, true, ['sign', 'verify']);
    const leaf = async (extensions: x509.Extension[]) =>
      (
        await x509.X509CertificateGenerator.create({
          serialNumber: '0a0b0c',
          subject: 'CN=laptop',
          issuer: caCert.subject,
          notBefore: new Date(NOW.getTime() - 60_000),
          notAfter: new Date(NOW.getTime() + 86_400_000),
          signingAlgorithm: EC,
          publicKey: leafKeys.publicKey,
          signingKey,
          extensions,
        })
      ).toString('pem');
    const check = async (extensions: x509.Extension[]) =>
      (
        await verifyDeviceCertificate({
          certificatePem: await leaf(extensions),
          trustBundlePem: ca.certificatePem,
          now: NOW,
        })
      ).reasons;
    const signature = new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true);

    expect(await check([signature, new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth])])).toEqual(
      [],
    );
    // No EKU: accepted on keyUsage digitalSignature alone.
    expect(await check([signature])).toEqual([]);
    // A TLS server / code signing certificate of the same company CA is no device certificate.
    expect(await check([signature, new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth])])).toEqual([
      'the device certificate is not for client authentication (extendedKeyUsage clientAuth)',
    ]);
    expect(
      await check([
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyEncipherment, true),
        new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth]),
      ]),
    ).toEqual(['the device certificate does not allow digital signatures (keyUsage digitalSignature)']);
    expect(await check([])).toEqual([
      'the device certificate does not allow digital signatures (keyUsage digitalSignature)',
    ]);
  });

  it('reports bundle issues', async () => {
    const { ca, issued } = await setup();

    expect(caBundleIssues(ca.certificatePem, NOW)).toEqual([]);
    expect(caBundleIssues(issued.certificatePem, NOW)[0]).toMatch(/not a CA/);
    expect(caBundleIssues('garbage', NOW).length).toBe(1);
  });
});
