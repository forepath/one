import { Injectable } from '@nestjs/common';

import type { MasterKeyKmsProvider } from './master-key-kms';

const REQUEST_TIMEOUT_MS = 10_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface VaultTransitConfig {
  address: string;
  token: string;
  namespace?: string;
  mount: string;
  key: string;
}

export function readVaultTransitConfig(env: NodeJS.ProcessEnv = process.env): VaultTransitConfig {
  const address = env['VAULT_ADDR'];
  const token = env['VAULT_TOKEN'];

  if (!address || !token) throw new Error('vault-transit needs VAULT_ADDR and VAULT_TOKEN');

  const url = new URL(address);

  // The master key travels to Vault for wrapping: TLS, except to a local agent / dev server.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
    throw new Error('VAULT_ADDR must use https');

  return {
    address: address.replace(/\/$/, ''),
    token,
    ...(env['VAULT_NAMESPACE'] ? { namespace: env['VAULT_NAMESPACE'] } : {}),
    mount: env['LOADWEAVER_VAULT_TRANSIT_MOUNT'] || 'transit',
    key: env['LOADWEAVER_VAULT_TRANSIT_KEY'] || 'loadweaver',
  };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * HashiCorp Vault / OpenBao transit engine (3.22). The wrapped value binds the master-key id, so a ciphertext
 * can't be swapped for another key's.
 */
@Injectable()
export class VaultTransitKms implements MasterKeyKmsProvider {
  readonly id = 'vault-transit';

  protected config(): VaultTransitConfig {
    return readVaultTransitConfig();
  }

  protected fetchImpl: FetchLike = (url, init) => fetch(url, init);

  keyRef(): string {
    const c = this.config();

    return `${c.address}/${c.mount}/${c.key}`;
  }

  private async call(operation: 'encrypt' | 'decrypt', body: Record<string, string>): Promise<Record<string, string>> {
    const c = this.config();
    const res = await this.fetchImpl(
      `${c.address}/v1/${encodeURIComponent(c.mount)}/${operation}/${encodeURIComponent(c.key)}`,
      {
        method: 'POST',
        headers: {
          'X-Vault-Token': c.token,
          'Content-Type': 'application/json',
          ...(c.namespace ? { 'X-Vault-Namespace': c.namespace } : {}),
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!res.ok) throw new Error(`vault ${operation} failed: HTTP ${res.status}`);

    return ((await res.json()) as { data: Record<string, string> }).data;
  }

  async wrap(key: Buffer, keyId: string): Promise<string> {
    const plaintext = Buffer.from(JSON.stringify({ keyId, key: key.toString('base64') })).toString('base64');

    return (await this.call('encrypt', { plaintext })).ciphertext;
  }

  async unwrap(wrapped: string, keyId: string): Promise<Buffer> {
    const plaintext = Buffer.from((await this.call('decrypt', { ciphertext: wrapped })).plaintext, 'base64').toString();
    const parsed = JSON.parse(plaintext) as { keyId: string; key: string };

    if (parsed.keyId !== keyId) throw new Error('the KMS returned a different master key');

    return Buffer.from(parsed.key, 'base64');
  }
}
