import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('AgentStateStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-agent-state-'));
    process.env['LOADWEAVER_STATE_DIR'] = join(dir, 'state');
  });

  afterEach(async () => {
    delete process.env['LOADWEAVER_STATE_DIR'];
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips identity, credentials and keys with restrictive permissions', async () => {
    const { AgentStateStore } = await import('./agent-state.store');
    const store = new AgentStateStore();

    expect(await store.credentials()).toBeNull();

    await store.saveIdentity({
      clusterId: 'c',
      nodeName: 'n1',
      controlPlaneUrl: 'https://cp',
      controlPlaneEndpoints: ['cp:7443'],
    });
    await store.saveCredentials({ privateKeyPem: 'k', certificatePem: 'c', caCertificatePem: 'ca' });
    await store.saveWireguardPrivateKey('wg');

    expect(await store.identity()).toMatchObject({ nodeName: 'n1' });
    expect(await store.credentials()).toEqual({ privateKeyPem: 'k', certificatePem: 'c', caCertificatePem: 'ca' });
    expect(await store.wireguardPrivateKey()).toBe('wg');
    expect((await stat(join(dir, 'state'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'state', 'node.key'))).mode & 0o777).toBe(0o600);
    expect((await stat(store.wireguardKeyPath())).mode & 0o777).toBe(0o600);
  });
});
