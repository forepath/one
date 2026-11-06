import { webcrypto } from 'node:crypto';

// Contract tests: assertions signed in the browser must verify with the API's verifier. Test-only cross-layer imports.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { verifyMtlsAssertion } from '../../../../backend/util-auth/src/lib/mtls/mtls-assertion';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { loadMtlsConfig } from '../../../../backend/util-auth/src/lib/mtls/mtls.config';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createTestCertificate,
  createTestPki,
  type TestKeyType,
} from '../../../../backend/util-auth/src/lib/mtls/testing/mtls-test-pki';

import {
  clearMtlsCredential,
  createMtlsAssertion,
  getMtlsAuthorizationHeader,
  hasMtlsCredential,
  importMtlsCredential,
  loadMtlsCredential,
  MTLS_ASSERTION_TYPE,
  MtlsCredentialError,
  parseCertificate,
  parsePemBlocks,
  resetMtlsCredentialStateForTests,
  saveMtlsCredential,
} from './mtls-credential';

const testCrypto = webcrypto as unknown as Crypto;

describe('mtls-credential', () => {
  const pki = createTestPki();
  const config = loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem });
  const originalCrypto = (globalThis as { crypto?: Crypto }).crypto;

  beforeAll(() => {
    // jsdom has no SubtleCrypto; module defaults read globalThis.crypto.
    Object.defineProperty(globalThis, 'crypto', { value: testCrypto, configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
  });

  beforeEach(() => {
    resetMtlsCredentialStateForTests();
  });

  const decodeSegment = (token: string, index: number) =>
    JSON.parse(Buffer.from(token.split('.')[index], 'base64url').toString('utf8'));

  describe('parsePemBlocks', () => {
    it('returns every block in order', () => {
      const blocks = parsePemBlocks(`junk\n${pki.client.pem}text\n${pki.client.privateKeyPem}`);

      expect(blocks.map((block) => block.label)).toEqual(['CERTIFICATE', 'PRIVATE KEY']);
      expect(Buffer.from(blocks[0].der).equals(pki.client.der)).toBe(true);
    });

    it('rejects invalid base64 bodies', () => {
      expect(() => parsePemBlocks('-----BEGIN CERTIFICATE-----\n@@@\n-----END CERTIFICATE-----')).toThrow(
        MtlsCredentialError,
      );
    });
  });

  describe('parseCertificate', () => {
    it.each<[TestKeyType, string]>([
      ['ec-p256', 'ES256'],
      ['ec-p384', 'ES384'],
      ['ec-p521', 'ES512'],
      ['rsa-2048', 'RS256'],
      ['ed25519', 'EdDSA'],
    ])('reads %s certificates (%s)', (keyType, algorithm) => {
      const certificate = createTestCertificate({
        commonName: `cn-${keyType}`,
        keyType,
        issuer: { certificate: pki.rootCa },
        notAfter: new Date('2061-03-04T05:06:07Z'),
      });
      const parsed = parseCertificate(new Uint8Array(certificate.der));

      expect(parsed.key.algorithm).toBe(algorithm);
      expect(parsed.commonName).toBe(`cn-${keyType}`);
      // GeneralizedTime (>= 2050)
      expect(parsed.notAfter).toBe(Date.UTC(2061, 2, 4, 5, 6, 7));
      expect(parsed.notBefore).toBe(Date.parse(certificate.certificate.validFrom));
    });

    it('rejects unsupported keys and garbage', () => {
      const secp256k1 = createTestCertificate({ commonName: 'k1', keyType: 'ec-secp256k1' });

      expect(() => parseCertificate(new Uint8Array(secp256k1.der))).toThrow(/Unsupported certificate key/);
      expect(() => parseCertificate(new Uint8Array([0x30, 0x82, 0xff]))).toThrow(MtlsCredentialError);
      expect(() => parseCertificate(new Uint8Array([0x30, 0x00]))).toThrow(MtlsCredentialError);
    });
  });

  describe('importMtlsCredential', () => {
    it('imports a combined PEM as a non-extractable key and signs assertions the API accepts', async () => {
      const credential = await importMtlsCredential(`${pki.client.pem}${pki.client.privateKeyPem}`);

      expect(credential.privateKey.extractable).toBe(false);
      expect(credential.privateKey.usages).toEqual(['sign']);
      expect(credential.algorithm).toBe('ES256');
      expect(credential.commonName).toBe('api-client');
      expect(credential.certificateChain).toEqual([pki.client.der.toString('base64')]);

      const assertion = await createMtlsAssertion(credential);
      const header = decodeSegment(assertion, 0);
      const payload = decodeSegment(assertion, 1);

      expect(header).toEqual({ alg: 'ES256', typ: MTLS_ASSERTION_TYPE, x5c: credential.certificateChain });
      expect(payload.exp - payload.iat).toBe(120);
      expect(payload.jti).toMatch(/^[0-9a-f]{32}$/);
      expect(verifyMtlsAssertion(assertion, config)).toEqual(
        expect.objectContaining({ source: 'assertion', commonName: 'api-client' }),
      );
    });

    it.each<TestKeyType>(['ec-p384', 'ec-p521', 'rsa-2048', 'ed25519'])(
      'produces API-verifiable assertions for %s keys',
      async (keyType) => {
        const leaf = createTestCertificate({ commonName: keyType, keyType, issuer: { certificate: pki.rootCa } });
        const credential = await importMtlsCredential(leaf.pem, leaf.privateKeyPem);

        expect(verifyMtlsAssertion(await createMtlsAssertion(credential), config).commonName).toBe(keyType);
      },
    );

    it('puts the leaf first and keeps intermediates (bundles in any order)', async () => {
      const credential = await importMtlsCredential(
        `${pki.intermediateCa.pem}${pki.intermediateClient.pem}`,
        pki.intermediateClient.privateKeyPem,
      );

      expect(credential.certificateChain).toEqual([
        pki.intermediateClient.der.toString('base64'),
        pki.intermediateCa.der.toString('base64'),
      ]);
      expect(verifyMtlsAssertion(await createMtlsAssertion(credential), config).commonName).toBe('intermediate-client');
    });

    it('sets the audience and lifetime', async () => {
      const credential = await importMtlsCredential(pki.client.pem, pki.client.privateKeyPem);
      const assertion = await createMtlsAssertion(credential, { audience: 'api-a', lifetimeSeconds: 60 });
      const payload = decodeSegment(assertion, 1);

      expect(payload.aud).toBe('api-a');
      expect(payload.exp - payload.iat).toBe(60);
      expect(
        verifyMtlsAssertion(
          assertion,
          loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem, MTLS_ASSERTION_AUDIENCE: 'api-a' }),
        ).commonName,
      ).toBe('api-client');
    });

    it.each([
      ['no certificate', () => [pki.client.privateKeyPem], /No certificate found/],
      ['no private key', () => [pki.client.pem], /No private key found/],
      [
        'an encrypted private key',
        () => [
          pki.client.pem,
          pki.client.privateKey
            .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'secret' })
            .toString(),
        ],
        /Encrypted private keys are not supported/,
      ],
      [
        'a SEC1 private key',
        () => [pki.client.pem, pki.client.privateKey.export({ type: 'sec1', format: 'pem' }).toString()],
        /Convert the private key to PKCS#8/,
      ],
      [
        'two private keys',
        () => [`${pki.client.pem}${pki.client.privateKeyPem}`, pki.client.privateKeyPem],
        /exactly one private key/,
      ],
      ['a key of another certificate', () => [pki.client.pem, pki.foreignClient.privateKeyPem], /does not belong/],
      ['more than five certificates', () => [pki.client.pem.repeat(6), pki.client.privateKeyPem], /at most 5/],
    ])('rejects %s', async (_label, files, message) => {
      const [certificateText, privateKeyText] = files();

      await expect(importMtlsCredential(certificateText, privateKeyText)).rejects.toThrow(message);
    });

    it('rejects PKCS#1 RSA keys, weak RSA keys and expired certificates', async () => {
      const rsa = createTestCertificate({
        commonName: 'rsa',
        keyType: 'rsa-2048',
        issuer: { certificate: pki.rootCa },
      });
      const weak = createTestCertificate({
        commonName: 'weak',
        keyType: 'rsa-1024',
        issuer: { certificate: pki.rootCa },
      });
      const expired = createTestCertificate({
        commonName: 'expired',
        issuer: { certificate: pki.rootCa },
        notBefore: new Date(Date.now() - 2 * 86_400_000),
        notAfter: new Date(Date.now() - 86_400_000),
      });
      const future = createTestCertificate({
        commonName: 'future',
        issuer: { certificate: pki.rootCa },
        notBefore: new Date(Date.now() + 86_400_000),
      });

      await expect(
        importMtlsCredential(rsa.pem, rsa.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()),
      ).rejects.toThrow(/PKCS#8/);
      await expect(importMtlsCredential(weak.pem, weak.privateKeyPem)).rejects.toThrow(/at least 2048 bits/);
      await expect(importMtlsCredential(expired.pem, expired.privateKeyPem)).rejects.toThrow(/expired/);
      await expect(importMtlsCredential(future.pem, future.privateKeyPem)).rejects.toThrow(/not valid yet/);
    });

    it('requires WebCrypto', async () => {
      await expect(
        importMtlsCredential(pki.client.pem, pki.client.privateKeyPem, { crypto: {} as Crypto }),
      ).rejects.toThrow(/secure context/);
    });
  });

  describe('storage and authorization header', () => {
    it('keeps the credential in memory when IndexedDB is unavailable and clears it on logout', async () => {
      expect(typeof indexedDB).toBe('undefined');
      await expect(loadMtlsCredential()).resolves.toBeNull();
      await expect(hasMtlsCredential()).resolves.toBe(false);
      await expect(getMtlsAuthorizationHeader()).resolves.toBeNull();

      const credential = await importMtlsCredential(pki.client.pem, pki.client.privateKeyPem);

      await saveMtlsCredential(credential);

      await expect(loadMtlsCredential()).resolves.toBe(credential);
      await expect(hasMtlsCredential()).resolves.toBe(true);

      await clearMtlsCredential();

      await expect(hasMtlsCredential()).resolves.toBe(false);
      await expect(getMtlsAuthorizationHeader()).resolves.toBeNull();
    });

    it('treats an expired stored certificate as signed out', async () => {
      const credential = await importMtlsCredential(pki.client.pem, pki.client.privateKeyPem);

      await saveMtlsCredential(credential);

      const afterExpiry = new Date(credential.notAfter + 1000);

      await expect(hasMtlsCredential(afterExpiry)).resolves.toBe(false);
      await expect(getMtlsAuthorizationHeader({ now: afterExpiry })).resolves.toBeNull();
    });

    it('reuses an assertion until it is about to expire and signs concurrent requests once', async () => {
      const credential = await importMtlsCredential(pki.client.pem, pki.client.privateKeyPem);

      await saveMtlsCredential(credential);

      const signSpy = jest.spyOn(testCrypto.subtle, 'sign');
      const start = new Date();
      const [first, concurrent] = await Promise.all([
        getMtlsAuthorizationHeader({ now: start }),
        getMtlsAuthorizationHeader({ now: start }),
      ]);

      expect(first).toMatch(/^Certificate [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(concurrent).toBe(first);
      expect(signSpy).toHaveBeenCalledTimes(1);

      // 80s later: 40s left (> 30s margin) → cached
      await expect(getMtlsAuthorizationHeader({ now: new Date(start.getTime() + 80_000) })).resolves.toBe(first);

      // 100s later: 20s left → fresh assertion
      const refreshed = await getMtlsAuthorizationHeader({ now: new Date(start.getTime() + 100_000) });

      expect(refreshed).not.toBe(first);
      expect(signSpy).toHaveBeenCalledTimes(2);

      // A different audience never reuses the cached assertion.
      const withAudience = await getMtlsAuthorizationHeader({
        now: new Date(start.getTime() + 100_000),
        audience: 'x',
      });

      expect(withAudience).not.toBe(refreshed);
      expect(
        verifyMtlsAssertion(
          (withAudience ?? '').slice('Certificate '.length),
          config,
          new Date(start.getTime() + 100_000),
        ).commonName,
      ).toBe('api-client');

      signSpy.mockRestore();
    });
  });
});
