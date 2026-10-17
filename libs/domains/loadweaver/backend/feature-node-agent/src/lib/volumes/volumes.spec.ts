import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VolumeAssignment } from '@forepath/loadweaver/shared/util-agent-protocol';

import { renderDrbdResource } from './drbd.renderer';
import { VolumePluginServer } from './volume-plugin.server';
import { VolumeManager } from './volume.manager';

const volume: VolumeAssignment = {
  id: 'shop/store/data',
  dockerName: 'lw-vol-shop.store.data',
  minor: 1000,
  port: 7800,
  sizeBytes: 10 * 1024 ** 3,
  replicas: [
    { node: 'n1', nodeId: 0, address: '10.93.0.1' },
    { node: 'n2', nodeId: 1, address: '10.93.0.2' },
    { node: 'b1', nodeId: 2, address: 'fd00:93::3' },
  ],
  connections: [
    { a: 'n1', b: 'n2', protocol: 'C' },
    { a: 'n1', b: 'b1', protocol: 'A' },
    { a: 'n2', b: 'b1', protocol: 'A' },
  ],
  primary: 'n1',
  keyRef: 'secret://shop/lw-volume-store.data',
};

describe('renderDrbdResource', () => {
  const conf = renderDrbdResource(volume);

  it('layers DRBD on the LUKS mapping with per-pair protocols', () => {
    expect(conf).toContain('resource "lw-1000" {');
    expect(conf).toContain('disk "/dev/mapper/lw-1000-crypt";');
    expect(conf).toContain('on "n1" { node-id 0; address ipv4 10.93.0.1:7800; }');
    expect(conf).toContain('on "b1" { node-id 2; address ipv6 [fd00:93::3]:7800; }');
    expect(conf).toContain('connection { host "n1"; host "n2"; net { protocol C; } }');
    expect(conf).toContain('connection { host "n2"; host "b1"; net { protocol A; } }');
  });

  it('never auto-promotes and uses quorum from three replicas', () => {
    expect(conf).toContain('auto-promote no;');
    expect(conf).toContain('quorum majority;');
    expect(renderDrbdResource({ ...volume, replicas: volume.replicas.slice(0, 2) })).toContain('quorum off;');
  });
});

describe('VolumeManager', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-vol-'));
    process.env['LOADWEAVER_DRBD_CONFIG_DIR'] = dir;
    process.env['LOADWEAVER_VOLUME_ROOT'] = join(dir, 'mnt');
  });

  afterEach(async () => {
    delete process.env['LOADWEAVER_DRBD_CONFIG_DIR'];
    delete process.env['LOADWEAVER_VOLUME_ROOT'];
    await rm(dir, { recursive: true, force: true });
  });

  function runner(state: { lvs: string[]; luks: boolean; mapped: boolean; up: boolean; fs?: string }) {
    const calls: { cmd: string; args: string[]; input?: unknown }[] = [];

    return {
      calls,
      json: jest.fn(async () => ({ report: [{ lv: state.lvs.map((lv_name) => ({ lv_name })) }] })),
      run: jest.fn(async (cmd: string, args: string[], options?: { input?: unknown }) => {
        calls.push({ cmd, args, input: options?.input });

        if (cmd === 'cryptsetup' && args[0] === 'isLuks' && !state.luks) throw new Error('not luks');

        if (cmd === 'dmsetup') return { stdout: state.mapped ? 'State: ACTIVE' : '', stderr: '' };

        if (cmd === 'drbdsetup')
          return { stdout: state.up ? 'lw-1000 role:Secondary' : '', stderr: state.up ? '' : 'No such resource' };

        if (cmd === 'blkid') return { stdout: state.fs ?? '', stderr: '' };

        return { stdout: '', stderr: '' };
      }),
    };
  }

  const secrets = { fetch: jest.fn(async () => Buffer.from('k'.repeat(64))) };

  it('creates, encrypts, formats metadata and brings up a fresh volume', async () => {
    const r = runner({ lvs: [], luks: false, mapped: false, up: false });
    const manager = new VolumeManager(r as never, secrets as never);

    expect(await manager.apply('n1', [volume])).toBe(true);

    const commands = r.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands).toEqual([
      'lvcreate -y -V 10737418240b -T loadweaver/pool -n lw-1000',
      'cryptsetup isLuks /dev/loadweaver/lw-1000',
      'cryptsetup luksFormat --type luks2 -q --key-file - /dev/loadweaver/lw-1000',
      'dmsetup info lw-1000-crypt',
      'cryptsetup open --type luks2 --key-file - /dev/loadweaver/lw-1000 lw-1000-crypt',
      'drbdadm create-md --force lw-1000',
      'drbdsetup status lw-1000',
      'drbdadm up lw-1000',
    ]);
    // The key reaches cryptsetup on stdin as raw bytes, never as an argument.
    expect(Buffer.isBuffer(r.calls[2].input)).toBe(true);
    expect(secrets.fetch).toHaveBeenCalledWith('volume:shop/store/data', 'secret://shop/lw-volume-store.data');
    expect(await readFile(join(dir, 'lw-1000.res'), 'utf8')).toContain('resource "lw-1000"');
  });

  it('leaves an existing, running volume alone and removes replicas no longer assigned', async () => {
    await writeFile(join(dir, 'lw-1000.res'), renderDrbdResource(volume));
    await writeFile(join(dir, 'lw-1001.res'), 'old');

    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true });
    const manager = new VolumeManager(r as never, secrets as never);

    await manager.apply('n1', [volume]);

    const commands = r.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands).not.toContain('drbdadm create-md --force lw-1000');
    expect(commands).toContain('drbdadm down lw-1001');
    expect(commands).toContain('lvremove -y loadweaver/lw-1001');
  });

  it('mounts only on the chosen primary and formats empty devices', async () => {
    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true, fs: '' });
    const primary = new VolumeManager(r as never, secrets as never);

    await primary.apply('n1', [volume]);

    const mountpoint = await primary.mount('lw-vol-shop.store.data');

    expect(mountpoint).toBe(join(dir, 'mnt', 'lw-vol-shop.store.data'));
    expect(r.calls.map((c) => [c.cmd, ...c.args].join(' '))).toEqual(
      expect.arrayContaining(['drbdadm primary lw-1000', 'mkfs.ext4 -q -L lw-1000 /dev/drbd1000']),
    );

    const secondary = new VolumeManager(
      runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true }) as never,
      secrets as never,
    );

    await secondary.apply('n2', [volume]);
    await expect(secondary.mount('lw-vol-shop.store.data')).rejects.toThrow('primary on n1');
  });
});

describe('VolumePluginServer', () => {
  const manager = {
    byDockerName: (name: string) => (name === volume.dockerName ? volume : undefined),
    mountpoint: () => '/var/lib/loadweaver/volumes/lw-vol-shop.store.data',
    mount: jest.fn(async () => '/var/lib/loadweaver/volumes/lw-vol-shop.store.data'),
    unmount: jest.fn(async () => undefined),
  };
  const server = new VolumePluginServer(manager as never);

  it('implements the Docker volume driver protocol', async () => {
    expect(await server.handlers['/Plugin.Activate']({})).toEqual({ Implements: ['VolumeDriver'] });
    expect(await server.handlers['/VolumeDriver.Create']({ Name: 'lw-vol-shop.store.data' })).toEqual({ Err: '' });
    expect(await server.handlers['/VolumeDriver.Create']({ Name: 'other' })).toEqual({
      Err: 'volumes are created by the Loadweaver control plane',
    });
    expect(await server.handlers['/VolumeDriver.Mount']({ Name: 'lw-vol-shop.store.data', ID: 'c1' })).toEqual({
      Mountpoint: '/var/lib/loadweaver/volumes/lw-vol-shop.store.data',
      Err: '',
    });
    expect(await server.handlers['/VolumeDriver.Get']({ Name: 'nope' })).toEqual({ Err: 'no such volume' });
  });
});
