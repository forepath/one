import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getMtlsConfig,
  loadMtlsConfig,
  MTLS_ASSERTION_DEFAULT_MAX_LIFETIME_SECONDS,
  MtlsConfigurationError,
  normalizeFingerprint,
} from './mtls.config';
import { createTestPki } from './testing/mtls-test-pki';

describe('mtls.config', () => {
  const pki = createTestPki();

  describe('loadMtlsConfig', () => {
    it('requires MTLS_CA_CERT or MTLS_CA_CERT_FILE', () => {
      expect(() => loadMtlsConfig({})).toThrow(MtlsConfigurationError);
      expect(() => loadMtlsConfig({ MTLS_CA_CERT: '   ' })).toThrow(/MTLS_CA_CERT/);
    });

    it('parses an inline CA bundle with escaped newlines', () => {
      const inline = `${pki.rootCa.pem}${pki.intermediateCa.pem}`.replace(/\n/g, '\\n');
      const config = loadMtlsConfig({ MTLS_CA_CERT: inline });

      expect(config.trustAnchors).toHaveLength(2);
      expect(config.trustAnchorsPem).toContain('BEGIN CERTIFICATE');
      expect(config.allowedFingerprints).toBeNull();
      expect(config.allowedSubjects).toBeNull();
      expect(config.revokedFingerprints.size).toBe(0);
      expect(config.assertionMaxLifetimeSeconds).toBe(MTLS_ASSERTION_DEFAULT_MAX_LIFETIME_SECONDS);
      expect(config.assertionAudience).toBeUndefined();
    });

    it('reads MTLS_CA_CERT_FILE and prefers the inline value', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mtls-config-'));

      try {
        const file = join(dir, 'ca.pem');

        writeFileSync(file, pki.rootCa.pem);

        expect(loadMtlsConfig({ MTLS_CA_CERT_FILE: file }).trustAnchors[0].raw.equals(pki.rootCa.der)).toBe(true);
        expect(
          loadMtlsConfig({ MTLS_CA_CERT_FILE: file, MTLS_CA_CERT: pki.intermediateCa.pem }).trustAnchors[0].raw.equals(
            pki.intermediateCa.der,
          ),
        ).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('fails on unreadable CA files and on bundles without certificates', () => {
      expect(() => loadMtlsConfig({ MTLS_CA_CERT_FILE: '/nonexistent/ca.pem' })).toThrow(/could not be read/);
      expect(() => loadMtlsConfig({ MTLS_CA_CERT: 'not a certificate' })).toThrow(/does not contain/);
      expect(() =>
        loadMtlsConfig({ MTLS_CA_CERT: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' }),
      ).toThrow(/invalid certificate/);
    });

    it('parses allowlists, revocations, lifetime and audience', () => {
      const colonFingerprint = pki.client.certificate.fingerprint256;
      const config = loadMtlsConfig({
        MTLS_CA_CERT: pki.rootCa.pem,
        MTLS_ALLOWED_FINGERPRINTS: ` ${colonFingerprint} , `,
        MTLS_ALLOWED_SUBJECTS: 'api-client, ci-runner',
        MTLS_REVOKED_FINGERPRINTS: pki.intermediateClient.fingerprint256.toUpperCase(),
        MTLS_ASSERTION_MAX_LIFETIME: '60',
        MTLS_ASSERTION_AUDIENCE: 'https://api.example.com',
      });

      expect([...(config.allowedFingerprints ?? [])]).toEqual([pki.client.fingerprint256]);
      expect([...(config.allowedSubjects ?? [])]).toEqual(['api-client', 'ci-runner']);
      expect(config.revokedFingerprints.has(pki.intermediateClient.fingerprint256)).toBe(true);
      expect(config.assertionMaxLifetimeSeconds).toBe(60);
      expect(config.assertionAudience).toBe('https://api.example.com');
    });

    it.each(['abc', 'zz'.repeat(32)])('rejects malformed fingerprint %s', (fingerprint) => {
      expect(() => loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem, MTLS_ALLOWED_FINGERPRINTS: fingerprint })).toThrow(
        /SHA-256 fingerprints/,
      );
      expect(() => loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem, MTLS_REVOKED_FINGERPRINTS: fingerprint })).toThrow(
        /MTLS_REVOKED_FINGERPRINTS/,
      );
    });

    it.each(['0', '3601', '-5', '1.5', 'ten'])('rejects MTLS_ASSERTION_MAX_LIFETIME=%s', (value) => {
      expect(() => loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem, MTLS_ASSERTION_MAX_LIFETIME: value })).toThrow(
        /MTLS_ASSERTION_MAX_LIFETIME/,
      );
    });
  });

  describe('normalizeFingerprint', () => {
    it('strips separators and lowercases', () => {
      expect(normalizeFingerprint('AB:CD:EF')).toBe('abcdef');
      expect(normalizeFingerprint(' ab cd ')).toBe('abcd');
    });
  });

  describe('getMtlsConfig', () => {
    const original = { ...process.env };

    afterEach(() => {
      process.env = { ...original };
    });

    it('caches until an MTLS_* variable changes', () => {
      process.env.MTLS_CA_CERT = pki.rootCa.pem;

      const first = getMtlsConfig();

      expect(getMtlsConfig()).toBe(first);

      process.env.MTLS_ALLOWED_SUBJECTS = 'api-client';

      const second = getMtlsConfig();

      expect(second).not.toBe(first);
      expect(second.allowedSubjects?.has('api-client')).toBe(true);
    });

    it('throws when the CA is missing', () => {
      delete process.env.MTLS_CA_CERT;
      delete process.env.MTLS_CA_CERT_FILE;

      expect(() => getMtlsConfig()).toThrow(MtlsConfigurationError);
    });
  });
});
