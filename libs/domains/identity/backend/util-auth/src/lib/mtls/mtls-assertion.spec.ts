import { generateKeyPairSync, sign } from 'node:crypto';

import {
  createMtlsAssertion,
  getMtlsAssertionAlgorithm,
  MTLS_ASSERTION_MAX_LENGTH,
  verifyMtlsAssertion,
} from './mtls-assertion';
import { MtlsVerificationError } from './mtls-certificate';
import { loadMtlsConfig, MTLS_ASSERTION_TYPE, type MtlsConfig } from './mtls.config';
import { createTestCertificate, createTestPki, type TestKeyType } from './testing/mtls-test-pki';

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('mtls certificate assertions', () => {
  const pki = createTestPki();
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  let config: MtlsConfig;

  beforeEach(() => {
    config = loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem });
  });

  function expectRejected(token: string, reason: RegExp, cfg = config) {
    expect(() => verifyMtlsAssertion(token, cfg, now)).toThrow(MtlsVerificationError);
    expect(() => verifyMtlsAssertion(token, cfg, now)).toThrow(reason);
  }

  /** Signs arbitrary header / payload with the client key (ES256 / P1363) — for malformed-claim cases. */
  function signRaw(header: Record<string, unknown>, payload: Record<string, unknown>, key = pki.client.privateKey) {
    const input = `${b64url(header)}.${b64url(payload)}`;
    const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });

    return `${input}.${signature.toString('base64url')}`;
  }

  const validHeader = () => ({
    alg: 'ES256',
    typ: MTLS_ASSERTION_TYPE,
    x5c: [pki.client.der.toString('base64')],
  });
  const validPayload = () => ({ iat: nowSeconds, exp: nowSeconds + 60, jti: 'abc' });

  it('round-trips an assertion created from PEM strings', () => {
    const token = createMtlsAssertion({
      certificateChain: pki.client.pem,
      privateKey: pki.client.privateKeyPem,
      now,
    });
    const principal = verifyMtlsAssertion(token, config, now);

    expect(principal.source).toBe('assertion');
    expect(principal.commonName).toBe('api-client');
    expect(principal.fingerprint256).toBe(pki.client.fingerprint256);
  });

  it('carries the intermediate chain in x5c', () => {
    const token = createMtlsAssertion({
      certificateChain: [pki.intermediateClient.certificate, pki.intermediateCa.der],
      privateKey: pki.intermediateClient.privateKey,
      now,
    });

    expect(verifyMtlsAssertion(token, config, now).commonName).toBe('intermediate-client');
  });

  it.each<[TestKeyType, string]>([
    ['ec-p256', 'ES256'],
    ['ec-p384', 'ES384'],
    ['ec-p521', 'ES512'],
    ['rsa-2048', 'RS256'],
    ['ed25519', 'EdDSA'],
  ])('supports %s keys (%s)', (keyType, alg) => {
    const leaf = createTestCertificate({ commonName: keyType, keyType, issuer: { certificate: pki.rootCa } });
    const token = createMtlsAssertion({ certificateChain: [leaf.certificate], privateKey: leaf.privateKey, now });
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());

    expect(header.alg).toBe(alg);
    expect(getMtlsAssertionAlgorithm(leaf.publicKey)).toBe(alg);
    expect(verifyMtlsAssertion(token, config, now).commonName).toBe(keyType);
  });

  it('rejects an assertion signed with a key that does not belong to the certificate', () => {
    const attackerKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    const token = createMtlsAssertion({ certificateChain: [pki.client.certificate], privateKey: attackerKey, now });

    expectRejected(token, /invalid assertion signature/);
  });

  it('rejects tampered payloads and headers', () => {
    const token = createMtlsAssertion({ certificateChain: pki.client.pem, privateKey: pki.client.privateKey, now });
    const [header, , signature] = token.split('.');
    const tamperedPayload = b64url({ ...validPayload(), exp: nowSeconds + 120 });

    expectRejected(`${header}.${tamperedPayload}.${signature}`, /invalid assertion signature/);

    // Swap in another trusted certificate: the signature no longer matches its key.
    const otherLeaf = createTestCertificate({ commonName: 'other', issuer: { certificate: pki.rootCa } });
    const swappedHeader = b64url({ ...validHeader(), x5c: [otherLeaf.der.toString('base64')] });

    expectRejected(`${swappedHeader}.${token.split('.')[1]}.${signature}`, /invalid assertion signature/);
  });

  it('rejects a valid signature by a certificate of an untrusted CA', () => {
    const token = createMtlsAssertion({
      certificateChain: [pki.foreignClient.certificate],
      privateKey: pki.foreignClient.privateKey,
      now,
    });

    expectRejected(token, /not issued by a trusted CA/);
  });

  it('rejects algorithm confusion (alg must match the certificate key)', () => {
    for (const alg of ['none', 'HS256', 'RS256', 'ES384', 'EdDSA']) {
      expectRejected(signRaw({ ...validHeader(), alg }, validPayload()), /does not match the certificate key/);
    }

    expectRejected(`${b64url({ ...validHeader(), alg: 'none' })}.${b64url(validPayload())}.`, /malformed/);
  });

  it('requires the explicit assertion type', () => {
    expectRejected(signRaw({ ...validHeader(), typ: 'JWT' }, validPayload()), /unexpected assertion type/);

    const { typ: _typ, ...withoutTyp } = validHeader();

    expectRejected(signRaw(withoutTyp, validPayload()), /unexpected assertion type/);
  });

  it.each(['crit', 'b64', 'jku', 'jwk', 'x5u'])('rejects the %s header parameter', (parameter) => {
    expectRejected(signRaw({ ...validHeader(), [parameter]: ['x'] }, validPayload()), /unsupported assertion header/);
  });

  it('requires a well-formed x5c chain', () => {
    expectRejected(signRaw({ ...validHeader(), x5c: [] }, validPayload()), /x5c/);
    expectRejected(signRaw({ ...validHeader(), x5c: 'abc' }, validPayload()), /x5c/);
    expectRejected(signRaw({ ...validHeader(), x5c: ['not base64!'] }, validPayload()), /x5c/);
    expectRejected(signRaw({ ...validHeader(), x5c: Array(6).fill(validHeader().x5c[0]) }, validPayload()), /x5c/);
    expectRejected(signRaw({ ...validHeader(), x5c: ['AAAA'] }, validPayload()), /not valid DER/);
  });

  it('validates iat / exp / nbf', () => {
    expectRejected(signRaw(validHeader(), { exp: nowSeconds + 60 }), /integer iat < exp/);
    expectRejected(signRaw(validHeader(), { iat: nowSeconds, exp: nowSeconds }), /integer iat < exp/);
    expectRejected(signRaw(validHeader(), { iat: '1', exp: nowSeconds + 60 }), /integer iat < exp/);
    expectRejected(signRaw(validHeader(), { iat: nowSeconds + 0.5, exp: nowSeconds + 60 }), /integer iat < exp/);
    expectRejected(signRaw(validHeader(), { iat: nowSeconds, exp: nowSeconds + 301 }), /lifetime exceeds/);
    expectRejected(signRaw(validHeader(), { iat: nowSeconds + 120, exp: nowSeconds + 180 }), /issued in the future/);
    expectRejected(signRaw(validHeader(), { iat: nowSeconds - 200, exp: nowSeconds - 60 }), /expired/);
    expectRejected(
      signRaw(validHeader(), { iat: nowSeconds, exp: nowSeconds + 60, nbf: nowSeconds + 120 }),
      /not yet valid/,
    );
    // Within the 30s clock skew.
    expect(
      verifyMtlsAssertion(signRaw(validHeader(), { iat: nowSeconds + 20, exp: nowSeconds + 80 }), config, now)
        .commonName,
    ).toBe('api-client');
    expect(
      verifyMtlsAssertion(signRaw(validHeader(), { iat: nowSeconds - 100, exp: nowSeconds - 10 }), config, now)
        .commonName,
    ).toBe('api-client');
  });

  it('honours MTLS_ASSERTION_MAX_LIFETIME', () => {
    const strict = loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem, MTLS_ASSERTION_MAX_LIFETIME: '30' });

    expectRejected(signRaw(validHeader(), validPayload()), /lifetime exceeds/, strict);
  });

  it('enforces the audience only when configured', () => {
    const withAudience = loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem, MTLS_ASSERTION_AUDIENCE: 'api-a' });
    const forA = createMtlsAssertion({
      certificateChain: pki.client.pem,
      privateKey: pki.client.privateKey,
      audience: 'api-a',
      now,
    });
    const forB = createMtlsAssertion({
      certificateChain: pki.client.pem,
      privateKey: pki.client.privateKey,
      audience: 'api-b',
      now,
    });
    const none = createMtlsAssertion({ certificateChain: pki.client.pem, privateKey: pki.client.privateKey, now });

    expect(verifyMtlsAssertion(forA, withAudience, now).commonName).toBe('api-client');
    expect(
      verifyMtlsAssertion(signRaw(validHeader(), { ...validPayload(), aud: ['x', 'api-a'] }), withAudience, now)
        .commonName,
    ).toBe('api-client');
    expectRejected(forB, /audience mismatch/, withAudience);
    expectRejected(none, /audience mismatch/, withAudience);
    expect(verifyMtlsAssertion(forB, config, now).commonName).toBe('api-client');
  });

  it('rejects malformed tokens', () => {
    expectRejected('abc', /malformed assertion/);
    expectRejected('a.b', /malformed assertion/);
    expectRejected('a.b.c.d', /malformed assertion/);
    expectRejected('a+b.c.d', /malformed assertion/);
    expectRejected(`${b64url('str')}.${b64url(validPayload())}.c2ln`, /malformed assertion header/);
    expectRejected(`${Buffer.from('{').toString('base64url')}.${b64url(validPayload())}.c2ln`, /malformed/);
    expectRejected(`${b64url(validHeader())}.${b64url([1])}.c2ln`, /malformed assertion payload/);
    expectRejected('a'.repeat(MTLS_ASSERTION_MAX_LENGTH + 1), /too large/);
  });

  it('rejects ECDSA signatures of the wrong length (e.g. DER-encoded)', () => {
    const input = `${b64url(validHeader())}.${b64url(validPayload())}`;
    const derSignature = sign('sha256', Buffer.from(input), pki.client.privateKey);

    expectRejected(`${input}.${derSignature.toString('base64url')}`, /invalid assertion signature/);
  });

  it('applies the certificate checks (e.g. revocation) to assertions', () => {
    const revoked = loadMtlsConfig({
      MTLS_CA_CERT: pki.rootCa.pem,
      MTLS_REVOKED_FINGERPRINTS: pki.client.fingerprint256,
    });

    expectRejected(signRaw(validHeader(), validPayload()), /revoked/, revoked);
  });

  it('createMtlsAssertion requires a certificate and sets the default lifetime', () => {
    expect(() => createMtlsAssertion({ certificateChain: [], privateKey: pki.client.privateKey })).toThrow(
      /certificateChain/,
    );

    const token = createMtlsAssertion({ certificateChain: pki.client.pem, privateKey: pki.client.privateKey, now });
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

    expect(payload.exp - payload.iat).toBe(120);
    expect(typeof payload.jti).toBe('string');
    expect(payload.aud).toBeUndefined();
  });
});
