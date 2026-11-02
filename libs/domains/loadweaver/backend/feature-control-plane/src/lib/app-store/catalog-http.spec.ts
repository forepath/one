import 'reflect-metadata';

import { webcrypto } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';

import * as x509 from '@peculiar/x509';

import { insecureTlsFetch } from './catalog-http';

const crypto = webcrypto as unknown as Crypto;

/** A self-signed certificate for 127.0.0.1 (PEM key + certificate). */
async function selfSigned(): Promise<{ key: string; cert: string }> {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: '01',
      name: 'CN=fleet.lab',
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 3_600_000),
      keys,
      signingAlgorithm: algorithm,
      extensions: [new x509.SubjectAlternativeNameExtension([{ type: 'ip', value: '127.0.0.1' }])],
    },
    crypto,
  );
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);

  return { key: x509.PemConverter.encode(pkcs8, 'PRIVATE KEY'), cert: cert.toString('pem') };
}

/** Fleet catalogs with a self-signed certificate (labs, `LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED=false`). */
describe('insecureTlsFetch (2026-11-01)', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    x509.cryptoProvider.set(crypto);
    server = createServer(await selfSigned(), (_req, res) => res.end('index'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/api/catalog/index.yaml`;
  });

  afterAll(async () => await new Promise((resolve) => server.close(resolve)));

  it('reads from a self-signed server through its own agent; the global fetch keeps refusing it', async () => {
    const response = await insecureTlsFetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('index');
    await expect(fetch(url)).rejects.toThrow();
  });
});
