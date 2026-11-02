import { MasterKeyKmsRegistry } from './master-key-kms';
import { readVaultTransitConfig, VaultTransitKms } from './vault-transit.kms';

describe('master-key KMS', () => {
  it('requires TLS to Vault except on loopback', () => {
    expect(() => readVaultTransitConfig({ VAULT_ADDR: 'http://vault.example.com:8200', VAULT_TOKEN: 't' })).toThrow(
      'https',
    );
    expect(readVaultTransitConfig({ VAULT_ADDR: 'http://127.0.0.1:8200/', VAULT_TOKEN: 't' })).toMatchObject({
      address: 'http://127.0.0.1:8200',
      mount: 'transit',
      key: 'loadweaver',
    });
    expect(() => readVaultTransitConfig({ VAULT_ADDR: 'https://vault.example.com' })).toThrow('VAULT_TOKEN');
  });

  it('binds the wrapped value to the master-key id', async () => {
    const store = new Map<string, string>();
    const kms = new VaultTransitKms();

    Object.assign(kms, {
      config: () => ({ address: 'https://vault', token: 't', mount: 'transit', key: 'k' }),
      fetchImpl: async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { plaintext?: string; ciphertext?: string };

        if (url.endsWith('/encrypt/k')) {
          const ciphertext = `vault:v1:${store.size}`;

          store.set(ciphertext, body.plaintext as string);

          return new Response(JSON.stringify({ data: { ciphertext } }));
        }

        return new Response(JSON.stringify({ data: { plaintext: store.get(body.ciphertext as string) } }));
      },
    });

    const wrapped = await kms.wrap(Buffer.from('master'), 'id-1');

    expect((await kms.unwrap(wrapped, 'id-1')).toString()).toBe('master');
    await expect(kms.unwrap(wrapped, 'id-2')).rejects.toThrow('different master key');
  });

  it('fails loudly for unknown providers', () => {
    const registry = new MasterKeyKmsRegistry();

    expect(registry.configured({})).toBeNull();
    expect(() => registry.configured({ LOADWEAVER_MASTER_KEY_KMS: 'aws-kms' })).toThrow('no registered KMS provider');
  });
});
