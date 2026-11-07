import type { AddressInfo } from 'node:net';
import { connect, createServer, type TLSSocket } from 'node:tls';

import { getMtlsHttpsOptions, getTlsPeerCertificateChain } from './mtls-transport';
import { MtlsConfigurationError } from './mtls.config';
import { createTestCertificate, createTestPki, OID_SERVER_AUTH } from './testing/mtls-test-pki';

describe('mtls transport', () => {
  const pki = createTestPki();
  const serverCertificate = createTestCertificate({
    commonName: 'localhost',
    issuer: { certificate: pki.rootCa },
    extendedKeyUsage: [OID_SERVER_AUTH],
  });
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getTlsPeerCertificateChain', () => {
    it('returns null for non-TLS sockets and sockets without a peer certificate', () => {
      expect(getTlsPeerCertificateChain(undefined)).toBeNull();
      expect(getTlsPeerCertificateChain({})).toBeNull();
      expect(
        getTlsPeerCertificateChain({ encrypted: false, getPeerCertificate: () => ({ raw: pki.client.der }) }),
      ).toBeNull();
      expect(getTlsPeerCertificateChain({ encrypted: true, getPeerCertificate: () => ({}) })).toBeNull();
      expect(getTlsPeerCertificateChain({ encrypted: true, getPeerCertificate: () => null })).toBeNull();
      expect(
        getTlsPeerCertificateChain({
          encrypted: true,
          getPeerCertificate: () => {
            throw new Error('socket closed');
          },
        }),
      ).toBeNull();
    });

    it('walks issuerCertificate links and stops at a self-referencing root', () => {
      const root: { raw: Buffer; issuerCertificate?: unknown } = { raw: pki.rootCa.der };

      root.issuerCertificate = root;

      const chain = getTlsPeerCertificateChain({
        encrypted: true,
        getPeerCertificate: () => ({
          raw: pki.intermediateClient.der,
          issuerCertificate: { raw: pki.intermediateCa.der, issuerCertificate: root },
        }),
      });

      expect(chain?.map((certificate) => certificate.subject)).toEqual([
        'CN=intermediate-client',
        'CN=Test Intermediate CA',
        'CN=Test Root CA',
      ]);
    });

    it('returns null for undecodable certificates', () => {
      expect(
        getTlsPeerCertificateChain({ encrypted: true, getPeerCertificate: () => ({ raw: Buffer.from('junk') }) }),
      ).toBeNull();
    });

    it('reads the client certificate of a real TLS handshake', async () => {
      process.env.AUTHENTICATION_METHOD = 'mtls';
      process.env.MTLS_CA_CERT = pki.rootCa.pem;
      process.env.MTLS_SERVER_CERT = serverCertificate.pem;
      process.env.MTLS_SERVER_KEY = serverCertificate.privateKeyPem;

      const options = getMtlsHttpsOptions();
      const peerChains: Array<string[] | null> = [];
      const server = createServer(options ?? {}, (socket: TLSSocket) => {
        peerChains.push(getTlsPeerCertificateChain(socket)?.map((certificate) => certificate.subject) ?? null);
        socket.end('ok');
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

      const { port } = server.address() as AddressInfo;
      const handshake = (clientOptions: { cert?: string; key?: string }) =>
        new Promise<void>((resolve, reject) => {
          const client = connect({
            port,
            host: '127.0.0.1',
            ca: pki.rootCa.pem,
            checkServerIdentity: () => undefined,
            ...clientOptions,
          });

          client.on('data', () => client.end());
          client.on('close', () => resolve());
          client.on('error', reject);
        });

      try {
        await handshake({ cert: pki.client.pem, key: pki.client.privateKeyPem });
        // No certificate: the handshake still succeeds (rejectUnauthorized: false); the guard rejects later.
        await handshake({});
        // Certificate of an unknown CA: also connects, but must never verify downstream.
        await handshake({ cert: pki.foreignClient.pem, key: pki.foreignClient.privateKeyPem });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }

      expect(peerChains[0]?.[0]).toBe('CN=api-client');
      expect(peerChains[1]).toBeNull();
      expect(peerChains[2]?.[0]).toBe('CN=api-client');
    });
  });

  describe('getMtlsHttpsOptions', () => {
    it('returns undefined without server certificate settings', () => {
      process.env.AUTHENTICATION_METHOD = 'mtls';

      expect(getMtlsHttpsOptions({})).toBeUndefined();
      expect(getMtlsHttpsOptions({ MTLS_SERVER_CERT: '', MTLS_SERVER_KEY_FILE: ' ' })).toBeUndefined();
    });

    it('requests (but does not require) client certificates from the trusted CA', () => {
      process.env.AUTHENTICATION_METHOD = 'mtls';
      process.env.MTLS_CA_CERT = pki.rootCa.pem;

      const options = getMtlsHttpsOptions({
        MTLS_SERVER_CERT: serverCertificate.pem,
        MTLS_SERVER_KEY: serverCertificate.privateKeyPem,
      });

      expect(options).toEqual({
        cert: serverCertificate.pem.trim(),
        key: serverCertificate.privateKeyPem.trim(),
        ca: expect.stringContaining('BEGIN CERTIFICATE'),
        requestCert: true,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
      });
    });

    it('fails for half-configured listeners, other auth methods and a missing CA', () => {
      process.env.AUTHENTICATION_METHOD = 'mtls';
      process.env.MTLS_CA_CERT = pki.rootCa.pem;

      expect(() => getMtlsHttpsOptions({ MTLS_SERVER_CERT: serverCertificate.pem })).toThrow(/must be set together/);

      process.env.AUTHENTICATION_METHOD = 'api-key';

      expect(() =>
        getMtlsHttpsOptions({
          MTLS_SERVER_CERT: serverCertificate.pem,
          MTLS_SERVER_KEY: serverCertificate.privateKeyPem,
        }),
      ).toThrow(/require AUTHENTICATION_METHOD=mtls/);

      process.env.AUTHENTICATION_METHOD = 'mtls';
      delete process.env.MTLS_CA_CERT;

      expect(() =>
        getMtlsHttpsOptions({
          MTLS_SERVER_CERT: serverCertificate.pem,
          MTLS_SERVER_KEY: serverCertificate.privateKeyPem,
        }),
      ).toThrow(MtlsConfigurationError);
    });
  });
});
