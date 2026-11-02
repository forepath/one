import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

/** `statfs` type the seed sees (null: the real one); the disk case is simulated (the test temp dir may be tmpfs). */
let fsType: number | null = null;

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises');

  return {
    ...actual,
    statfs: jest.fn(async (path: string) => (fsType === null ? actual.statfs(path) : { type: fsType })),
  };
});

import {
  CloudInitSeed,
  renderNetworkConfig,
  seedFiles,
  substituteSecretRefs,
  VM_DNS_PLACEHOLDER,
} from './cloud-init-seed';

/** The control plane's network config (W3 `vmNetworkConfig`): JSON, DNS placeholder on the primary NIC, no MTU. */
const NETWORK = JSON.stringify({
  version: 2,
  ethernets: {
    eth0: {
      match: { macaddress: '52:54:00:aa:bb:cc' },
      'set-name': 'eth0',
      addresses: ['10.42.0.7/32', 'fd42::7/128'],
      routes: [
        { to: '0.0.0.0/0', via: '169.254.1.1', 'on-link': true },
        { to: '::/0', via: 'fe80::1' },
      ],
      nameservers: { addresses: [VM_DNS_PLACEHOLDER], search: ['lw-vm.shop.lw.internal'] },
    },
    eth1: {
      match: { macaddress: '52:54:00:dd:ee:ff' },
      'set-name': 'eth1',
      addresses: ['10.43.0.9/32'],
      routes: [{ to: '0.0.0.0/0', via: '169.254.1.1', 'on-link': true, table: 101 }],
      'routing-policy': [{ from: '10.43.0.9/32', table: 101 }],
    },
  },
});

describe('cloud-init seed (M7.3)', () => {
  describe('renderNetworkConfig', () => {
    it("fills in the node's resolvers and the interfaces' MTU on every NIC", () => {
      const rendered = JSON.parse(renderNetworkConfig(NETWORK, ['10.42.0.1', 'fd42::1'], 1420));

      expect(rendered.ethernets.eth0.nameservers).toEqual({
        addresses: ['10.42.0.1', 'fd42::1'],
        search: ['lw-vm.shop.lw.internal'],
      });
      expect(rendered.ethernets.eth0.mtu).toBe(1420);
      expect(rendered.ethernets.eth1.mtu).toBe(1420);
      expect(rendered.ethernets.eth1.nameservers).toBeUndefined();
      expect(JSON.stringify(rendered)).not.toContain(VM_DNS_PLACEHOLDER);
    });

    it('drops the placeholder without resolvers and keeps an MTU the spec set', () => {
      const withMtu = JSON.parse(NETWORK);

      withMtu.ethernets.eth1.mtu = 9000;

      const rendered = JSON.parse(renderNetworkConfig(JSON.stringify(withMtu), []));

      expect(rendered.ethernets.eth0.nameservers).toEqual({ search: ['lw-vm.shop.lw.internal'] });
      expect(rendered.ethernets.eth0.mtu).toBeUndefined();
      expect(rendered.ethernets.eth1.mtu).toBe(9000);
    });

    it('refuses a network config that is no JSON', () => {
      expect(() => renderNetworkConfig('ethernets: {}', [])).toThrow('not valid JSON');
    });
  });

  describe('substituteSecretRefs', () => {
    const values = new Map([
      ['secret://shop/db', 'pw-db'],
      ['secret://shop/db-admin@3', 'pw-admin'],
    ]);

    it('replaces whole references only (a ref that is a prefix of another stays apart)', () => {
      expect(
        substituteSecretRefs('a: secret://shop/db\nb: secret://shop/db-admin@3\nc: "secret://shop/db"', values),
      ).toBe('a: pw-db\nb: pw-admin\nc: "pw-db"');
    });

    it('refuses references the spec does not list', () => {
      expect(() => substituteSecretRefs('x: secret://shop/other', values)).toThrow(
        "references secret://shop/other, which the VM spec doesn't list",
      );
      expect(() => substituteSecretRefs('x: secret://shop/db@2', values)).toThrow('secret://shop/db@2');
    });
  });

  describe('seedFiles', () => {
    const cloudInit = { metaData: '{"instance-id":"u-1","local-hostname":"db1"}', secretRefs: [] };

    it('always has user-data (NoCloud wants both files) and network-config only when given', () => {
      expect(seedFiles(cloudInit, { dnsServers: [] }, new Map())).toEqual({
        'meta-data': cloudInit.metaData,
        'user-data': '#cloud-config\n',
      });
    });

    it('turns a userDataSecret (just the reference) into its value', () => {
      const files = seedFiles(
        { ...cloudInit, userData: 'secret://shop/db1-userdata', secretRefs: ['secret://shop/db1-userdata'] },
        { dnsServers: ['10.42.0.1'] },
        new Map([['secret://shop/db1-userdata', '#cloud-config\npackages: [nginx]\n']]),
      );

      expect(files['user-data']).toBe('#cloud-config\npackages: [nginx]\n');
    });

    it('refuses files seed-build would refuse (> 1 MiB)', () => {
      expect(() =>
        seedFiles(
          { ...cloudInit, userData: 'secret://shop/big', secretRefs: ['secret://shop/big'] },
          { dnsServers: [] },
          new Map([['secret://shop/big', 'x'.repeat(1024 * 1024 + 1)]]),
        ),
      ).toThrow('larger than 1 MiB');
    });
  });

  describe('CloudInitSeed', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'lw-seed-'));
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      fsType = null;
      await rm(dir, { recursive: true, force: true });
    });

    const spec = (cloudInit?: NonNullable<WorkloadSpec['vm']>['cloudInit']) =>
      ({ id: 'shop/lw-vm/db1/0', vm: { cloudInit } }) as unknown as WorkloadSpec;

    it('writes the seed root-only into the run directory with secrets resolved for this workload, zeroing them', async () => {
      const values: Buffer[] = [];
      const secrets = {
        fetch: jest.fn(async (_workload: string, ref: string) => {
          const value = Buffer.from(ref.endsWith('pw') ? 'hunter2' : 'ssh-ed25519 AAAA');

          values.push(value);

          return value;
        }),
      };
      const seed = new CloudInitSeed(secrets as never);

      jest.spyOn(seed, 'assertMemoryFs').mockResolvedValue(undefined);

      const written = await seed.write(
        spec({
          metaData: '{"instance-id":"u-1"}',
          networkConfig: NETWORK,
          userData: '#cloud-config\npassword: secret://shop/pw\n',
          secretRefs: ['secret://shop/pw'],
        }),
        dir,
        { dnsServers: ['10.42.0.1'], mtu: 1420 },
      );

      expect(written).toBe(true);
      expect(secrets.fetch).toHaveBeenCalledWith('shop/lw-vm/db1/0', 'secret://shop/pw');
      expect(values.every((v) => v.every((b) => b === 0))).toBe(true);
      expect((await readdir(join(dir, 'seed'))).sort()).toEqual(['meta-data', 'network-config', 'user-data']);
      expect(await readFile(join(dir, 'seed', 'user-data'), 'utf8')).toBe('#cloud-config\npassword: hunter2\n');
      expect(await readFile(join(dir, 'seed', 'network-config'), 'utf8')).toContain('"addresses":["10.42.0.1"]');
      expect((await stat(join(dir, 'seed', 'user-data'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(dir, 'seed'))).mode & 0o777).toBe(0o700);
    });

    it('rebuilds the seed on every start and removes it for a VM without cloud-init', async () => {
      const seed = new CloudInitSeed({ fetch: jest.fn() } as never);

      jest.spyOn(seed, 'assertMemoryFs').mockResolvedValue(undefined);
      await mkdir(join(dir, 'seed'));
      await writeFile(join(dir, 'seed', 'user-data'), 'old');

      await seed.write(spec({ metaData: '{}', secretRefs: [] }), dir, { dnsServers: [] });
      expect(await readFile(join(dir, 'seed', 'user-data'), 'utf8')).toBe('#cloud-config\n');

      expect(await seed.write(spec(undefined), dir, { dnsServers: [] })).toBe(false);
      await expect(stat(join(dir, 'seed'))).rejects.toThrow();
    });

    it('never writes the seed outside tmpfs', async () => {
      const secrets = { fetch: jest.fn() };
      const seed = new CloudInitSeed(secrets as never);

      fsType = 0xef53; // ext4
      await expect(
        seed.write(spec({ metaData: '{}', userData: 'secret://shop/pw', secretRefs: ['secret://shop/pw'] }), dir, {
          dnsServers: [],
        }),
      ).rejects.toThrow('is not tmpfs');
      expect(secrets.fetch).not.toHaveBeenCalled();
      await expect(stat(join(dir, 'seed'))).rejects.toThrow();
    });
  });
});
