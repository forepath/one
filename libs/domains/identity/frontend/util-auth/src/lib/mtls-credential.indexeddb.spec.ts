import 'fake-indexeddb/auto';

import { webcrypto } from 'node:crypto';
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';

// eslint-disable-next-line @nx/enforce-module-boundaries
import { verifyMtlsAssertion } from '../../../../backend/util-auth/src/lib/mtls/mtls-assertion';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { loadMtlsConfig } from '../../../../backend/util-auth/src/lib/mtls/mtls.config';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createTestPki } from '../../../../backend/util-auth/src/lib/mtls/testing/mtls-test-pki';

import {
  clearMtlsCredential,
  getMtlsAuthorizationHeader,
  hasMtlsCredential,
  importMtlsCredential,
  loadMtlsCredential,
  resetMtlsCredentialStateForTests,
  saveMtlsCredential,
} from './mtls-credential';

describe('mtls-credential (IndexedDB persistence)', () => {
  const pki = createTestPki();
  const originalCrypto = (globalThis as { crypto?: Crypto }).crypto;
  const originalStructuredClone = (globalThis as { structuredClone?: unknown }).structuredClone;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    // jsdom lacks structuredClone; browsers clone CryptoKeys into IndexedDB natively. Use Node's HTML structured
    // clone (MessagePort) so the stored key round-trips like in a browser.
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: <T>(value: T): T => {
        const { port1, port2 } = new MessageChannel();

        try {
          port1.postMessage(value);

          return receiveMessageOnPort(port2)?.message as T;
        } finally {
          port1.close();
          port2.close();
        }
      },
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    Object.defineProperty(globalThis, 'structuredClone', { value: originalStructuredClone, configurable: true });
  });

  beforeEach(async () => {
    resetMtlsCredentialStateForTests();
    await clearMtlsCredential();
    resetMtlsCredentialStateForTests();
  });

  it('survives a page reload as a non-extractable key that still signs valid assertions', async () => {
    await saveMtlsCredential(await importMtlsCredential(pki.client.pem, pki.client.privateKeyPem));

    // Simulate a reload: drop the in-memory copy, read back from IndexedDB.
    resetMtlsCredentialStateForTests();

    const restored = await loadMtlsCredential();

    expect(restored?.privateKey.extractable).toBe(false);
    expect(restored?.commonName).toBe('api-client');
    await expect(webcrypto.subtle.exportKey('pkcs8', restored?.privateKey as never)).rejects.toThrow();

    const header = await getMtlsAuthorizationHeader();
    const principal = verifyMtlsAssertion(
      (header ?? '').slice('Certificate '.length),
      loadMtlsConfig({ MTLS_CA_CERT: pki.rootCa.pem }),
    );

    expect(principal.fingerprint256).toBe(pki.client.fingerprint256);
  });

  it('removes the persisted credential on clear', async () => {
    await saveMtlsCredential(await importMtlsCredential(pki.client.pem, pki.client.privateKeyPem));
    await clearMtlsCredential();
    resetMtlsCredentialStateForTests();

    await expect(hasMtlsCredential()).resolves.toBe(false);
  });

  it('ignores malformed stored values', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('forepath-identity', 1);

      open.onupgradeneeded = () => open.result.createObjectStore('credentials');

      open.onsuccess = () => {
        const request = open.result.transaction('credentials', 'readwrite').objectStore('credentials').put('x', 'mtls');

        request.onsuccess = () => {
          open.result.close();
          resolve();
        };

        request.onerror = () => reject(request.error);
      };

      open.onerror = () => reject(open.error);
    });
    resetMtlsCredentialStateForTests();

    await expect(loadMtlsCredential()).resolves.toBeNull();
  });
});
