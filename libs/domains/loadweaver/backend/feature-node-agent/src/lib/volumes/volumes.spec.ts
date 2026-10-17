import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VolumeAssignment } from '@forepath/loadweaver/shared/util-agent-protocol';

import { CommandError } from '../host/command-runner';
import { renderDrbdResource, renderedNodeIds } from './drbd.renderer';
import { VolumePluginServer } from './volume-plugin.server';
import { VolumeManager, volumeKey } from './volume.manager';

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

  it("names each replica's host by its reported kernel host name, falling back to the node name", () => {
    const hosted = renderDrbdResource({
      ...volume,
      replicas: volume.replicas.map((r) => (r.node === 'b1' ? r : { ...r, host: `${r.node}.dc1.example` })),
    });

    expect(hosted).toContain('on "n1.dc1.example" { node-id 0; address ipv4 10.93.0.1:7800; }');
    expect(hosted).toContain('on "b1" { node-id 2; address ipv6 [fd00:93::3]:7800; }');
    expect(hosted).toContain('connection { host "n1.dc1.example"; host "n2.dc1.example"; net { protocol C; } }');
    expect(hosted).toContain('connection { host "n2.dc1.example"; host "b1"; net { protocol A; } }');
    expect(renderedNodeIds(hosted)).toEqual(
      new Map([
        [0, 'n1.dc1.example'],
        [1, 'n2.dc1.example'],
        [2, 'b1'],
      ]),
    );
  });

  it('enables online verify', () => {
    expect(conf).toContain('verify-alg sha256;');
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
    process.env['LOADWEAVER_KEY_TMPFS'] = join(dir, 'keys');
    // The unit tests' temp dir isn't tmpfs; the check itself is covered below.
    jest
      .spyOn(VolumeManager.prototype as unknown as { assertMemoryFs: () => Promise<void> }, 'assertMemoryFs')
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    delete process.env['LOADWEAVER_DRBD_CONFIG_DIR'];
    delete process.env['LOADWEAVER_VOLUME_ROOT'];
    delete process.env['LOADWEAVER_KEY_TMPFS'];
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  interface State {
    lvs: string[];
    luks: boolean;
    mapped: boolean;
    up: boolean;
    fs?: string;
    /** Local disk state while up (default UpToDate). */
    disk?: string;
    /** Peer → peer disk state; absent peers are not connected (default: all peers UpToDate). */
    peers?: Record<string, string>;
    /** Current UUID from `drbdadm get-gi`. */
    uuid?: string;
    /** `drbdadm up` fails like real DRBD on a device without metadata. */
    noMetadata?: boolean;
    /** LVs present but not activated (after boot, before LVM autoactivation). */
    inactive?: boolean;
    /** The LV's device node is missing (cryptsetup exit 4). */
    lvMissing?: boolean;
    /** Signature `blkid` finds on the LV itself. */
    lvFs?: string;
    /** `cryptsetup --help` output (default: empty, i.e. a current cryptsetup). */
    cryptsetupHelp?: string;
    forgetFails?: boolean;
    /** `forget-peer` fails with DRBD's answer for a slot it no longer has (already forgotten). */
    forgetUnknown?: boolean;
    /** `drbdadm adjust` fails this many times. */
    adjustFails?: number;
  }

  /** `drbdsetup status --json` as DRBD 9.2 prints it (fields the manager reads). */
  function drbdJson(state: State): string {
    const peers = state.peers ?? { n2: 'UpToDate', b1: 'UpToDate' };

    return JSON.stringify([
      {
        name: 'lw-1000',
        role: 'Secondary',
        devices: [{ volume: 0, 'disk-state': state.disk ?? 'UpToDate' }],
        connections: ['n1', 'n2', 'b1']
          .filter((n) => n in peers)
          .map((n) => ({
            name: n,
            'connection-state': 'Connected',
            peer_devices: [{ volume: 0, 'peer-disk-state': peers[n] }],
          })),
      },
    ]);
  }

  function runner(state: State) {
    const calls: { cmd: string; args: string[]; input?: unknown; volumeKey?: Buffer }[] = [];

    return {
      calls,
      json: jest.fn(async () => ({
        report: [{ lv: state.lvs.map((lv_name) => ({ lv_name, lv_active: state.inactive ? '' : 'active' })) }],
      })),
      run: jest.fn(async (cmd: string, args: string[], options?: { input?: unknown }) => {
        const keyFlag = args.findIndex((a) => a === '--volume-key-file' || a === '--master-key-file');

        // The volume key file only exists while cryptsetup runs.
        calls.push({
          cmd,
          args,
          input: options?.input,
          ...(keyFlag >= 0 ? { volumeKey: await readFile(args[keyFlag + 1]) } : {}),
        });

        if (cmd === 'cryptsetup' && args[0] === '--help') return { stdout: state.cryptsetupHelp ?? '', stderr: '' };

        if (cmd === 'drbdadm' && args[0] === 'adjust' && state.adjustFails) {
          state.adjustFails--;
          throw new CommandError(cmd, args, 10, 'adjust failed');
        }

        if (cmd === 'drbdsetup' && args[0] === 'forget-peer' && state.forgetFails)
          throw new CommandError(cmd, args, 10, 'failed');

        if (cmd === 'drbdsetup' && args[0] === 'forget-peer' && state.forgetUnknown)
          throw new CommandError(cmd, args, 10, 'lw-1000: Failure: (171) Invalid peer-node-id');

        if (cmd === 'cryptsetup' && args[0] === 'isLuks' && !state.luks)
          throw new CommandError(cmd, args, state.lvMissing ? 4 : 1, 'not a valid LUKS device');

        if (cmd === 'blkid' && args.includes('/dev/loadweaver/lw-1000'))
          return { stdout: state.lvFs ?? '', stderr: '' };

        if (cmd === 'dmsetup') return { stdout: state.mapped ? 'State: ACTIVE' : '', stderr: '' };

        if (cmd === 'drbdsetup')
          return state.up
            ? { stdout: drbdJson(state), stderr: '' }
            : { stdout: '[\n]\n', stderr: 'lw-1000: No such resource' };

        if (cmd === 'drbdadm' && args[0] === 'up' && state.noMetadata) {
          state.up = true;
          state.disk = 'Diskless';
          throw new CommandError(cmd, args, 1, 'No valid meta data found');
        }

        if (cmd === 'drbdadm' && args[0] === 'get-gi')
          return { stdout: `${state.uuid ?? '0000000000000004'}:0000000000000000:0:0:0:0:1:1:0:0:1\n`, stderr: '' };

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
      `lvcreate -y --config ${VolumeManager.THIN_CHECK_CONFIG} -V 10737418240b -T loadweaver/pool -n lw-1000`,
      'cryptsetup isLuks /dev/loadweaver/lw-1000',
      'blkid -p -o value -s TYPE /dev/loadweaver/lw-1000',
      'cryptsetup --help',
      `cryptsetup luksFormat --type luks2 -q --cipher aes-xts-plain64 --key-size 512 --sector-size 4096 --offset 32768 --pbkdf pbkdf2 --pbkdf-force-iterations 1000 --volume-key-file ${r.calls[4]?.args[17]} --key-file - /dev/loadweaver/lw-1000`,
      'dmsetup info lw-1000-crypt',
      'cryptsetup open --type luks2 --key-file - /dev/loadweaver/lw-1000 lw-1000-crypt',
      'drbdadm create-md --max-peers=7 --force lw-1000',
      'drbdsetup status lw-1000 --json',
      'drbdadm up lw-1000',
    ]);
    // The passphrase reaches cryptsetup on stdin as raw bytes, never as an argument.
    expect(Buffer.isBuffer(r.calls[4].input)).toBe(true);
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

    expect(commands.filter((c) => c.startsWith('drbdadm create-md') || c === 'drbdadm up lw-1000')).toEqual([]);
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

  // Found in the VM lab (M6 step 1a): on real DRBD a new volume is Inconsistent everywhere and can't be promoted.
  it('declares a brand-new volume current on first mount once every replica is connected', async () => {
    const r = runner({
      lvs: ['lw-1000'],
      luks: true,
      mapped: true,
      up: true,
      fs: '',
      disk: 'Inconsistent',
      peers: { n2: 'Inconsistent', b1: 'Inconsistent' },
    });
    const manager = new VolumeManager(r as never, secrets as never);

    await manager.apply('n1', [volume]);
    await manager.mount('lw-vol-shop.store.data');

    const commands = r.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands.indexOf('drbdadm new-current-uuid --clear-bitmap lw-1000/0')).toBeGreaterThan(-1);
    expect(commands.indexOf('drbdadm new-current-uuid --clear-bitmap lw-1000/0')).toBeLessThan(
      commands.indexOf('drbdadm primary lw-1000'),
    );
  });

  it('never declares data current while a replica is missing or the metadata held data before', async () => {
    const cases: { peers: Record<string, string>; uuid?: string }[] = [
      { peers: { n2: 'Inconsistent' } },
      { peers: { n2: 'Inconsistent', b1: 'Inconsistent' }, uuid: 'DA1A48585223F406' },
      { peers: { n2: 'UpToDate', b1: 'UpToDate' } },
    ];

    for (const state of cases) {
      const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true, disk: 'Inconsistent', ...state });
      const manager = new VolumeManager(r as never, secrets as never);

      await manager.apply('n1', [volume]);

      const mount = manager.mount('lw-vol-shop.store.data');

      if (state.peers.b1 === 'UpToDate') await mount;
      else await expect(mount).rejects.toThrow(state.uuid ? 'no up-to-date replica here' : 'waiting for b1');

      expect(r.calls.some((c) => c.args[0] === 'new-current-uuid')).toBe(false);
    }
  });

  it('force-promotes a new single-replica volume', async () => {
    const single = { ...volume, replicas: volume.replicas.slice(0, 1), connections: [] };
    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true, disk: 'Inconsistent', peers: {} });
    const manager = new VolumeManager(r as never, secrets as never);

    await manager.apply('n1', [single]);
    await manager.mount('lw-vol-shop.store.data');

    expect(r.calls.map((c) => [c.cmd, ...c.args].join(' '))).toContain('drbdadm primary --force lw-1000');
  });

  it('recovers an apply that stopped between luksFormat and create-md', async () => {
    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: false, noMetadata: true });
    const manager = new VolumeManager(r as never, secrets as never);

    await manager.apply('n1', [volume]);

    expect(r.calls.map((c) => [c.cmd, ...c.args].join(' ')).filter((c) => c.startsWith('drbdadm'))).toEqual([
      'drbdadm up lw-1000',
      'drbdadm create-md --max-peers=7 --force lw-1000',
      'drbdadm adjust lw-1000',
    ]);
  });

  it('re-attaches a resource that is up without its disk', async () => {
    await writeFile(join(dir, 'lw-1000.res'), renderDrbdResource(volume));

    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true, disk: 'Diskless' });
    const manager = new VolumeManager(r as never, secrets as never);

    expect(await manager.apply('n1', [volume])).toBe(true);
    expect(r.calls.map((c) => [c.cmd, ...c.args].join(' '))).toContain('drbdadm adjust lw-1000');
  });

  it('activates LVs LVM has not activated yet before touching them', async () => {
    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: false, up: false, inactive: true });
    const manager = new VolumeManager(r as never, secrets as never);

    await manager.apply('n1', [volume]);

    const commands = r.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands[0]).toBe(`lvchange -ay --config ${VolumeManager.THIN_CHECK_CONFIG} loadweaver/lw-1000`);
    expect(commands.some((c) => c.includes('luksFormat'))).toBe(false);
  });

  // Found in the VM lab: activating the pool while LVM's boot-time autoactivation still runs fails its thin_check.
  it('retries activation after udev settled and accepts an LV autoactivation activated meanwhile', async () => {
    const state: Parameters<typeof runner>[0] = {
      lvs: ['lw-1000'],
      luks: true,
      mapped: true,
      up: true,
      inactive: true,
    };
    const r = runner(state);
    const run = r.run.getMockImplementation() as NonNullable<ReturnType<typeof r.run.getMockImplementation>>;
    let failures = 1;

    r.run.mockImplementation(async (cmd: string, args: string[], options?: { input?: unknown }) => {
      if (cmd === 'lvchange' && failures-- > 0) {
        r.calls.push({ cmd, args });
        throw new CommandError(
          cmd,
          args,
          5,
          'Check of pool loadweaver/pool failed (status:64). Manual repair required!',
        );
      }

      if (cmd === 'udevadm') state.inactive = false; // autoactivation finished

      return run(cmd, args, options);
    });

    const manager = new VolumeManager(r as never, secrets as never);

    (manager as unknown as { activationRetryMs: number }).activationRetryMs = 0;
    await manager.apply('n1', [volume]);

    const commands = r.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands.slice(0, 2)).toEqual([
      `lvchange -ay --config ${VolumeManager.THIN_CHECK_CONFIG} loadweaver/lw-1000`,
      'udevadm settle --timeout=30',
    ]);
    expect(commands.filter((c) => c.startsWith('lvchange'))).toHaveLength(1);

    // Still failing after four attempts: reported.
    const broken = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true, inactive: true });
    const brokenRun = broken.run.getMockImplementation() as typeof run;

    broken.run.mockImplementation(async (cmd: string, args: string[], options?: { input?: unknown }) => {
      if (cmd === 'lvchange') throw new CommandError(cmd, args, 5, 'Check of pool loadweaver/pool failed (status:64).');

      return brokenRun(cmd, args, options);
    });

    const failing = new VolumeManager(broken as never, secrets as never);

    (failing as unknown as { activationRetryMs: number }).activationRetryMs = 0;
    await expect(failing.apply('n1', [volume])).rejects.toThrow('Check of pool loadweaver/pool failed');
  });

  // Found in the VM lab: after a power cut thin_check reports leaked data blocks (non-fatal) and LVM's default
  // options refuse the pool ("Check of pool … failed (status:64)"); the agent's activations accept non-fatal errors.
  it('activates thin volumes with thin_check accepting non-fatal errors (leaked blocks after a crash), nothing else', () => {
    expect(VolumeManager.THIN_CHECK_CONFIG).toBe(
      'global { thin_check_options = [ "-q", "--clear-needs-check-flag", "--ignore-non-fatal-errors" ] }',
    );
    expect(VolumeManager.THIN_CHECK_CONFIG).not.toMatch(/skip-mappings|auto-repair/);
  });

  it('never formats a device that is missing or holds other data', async () => {
    for (const state of [{ lvMissing: true }, { lvFs: 'ext4' }]) {
      const r = runner({ lvs: ['lw-1000'], luks: false, mapped: false, up: false, ...state });
      const manager = new VolumeManager(r as never, secrets as never);

      await expect(manager.apply('n1', [volume])).rejects.toThrow(
        state.lvFs ? 'holds ext4, not LUKS; refusing to format it' : 'exit 4',
      );
      expect(r.calls.some((c) => c.args[0] === 'luksFormat')).toBe(false);
    }
  });

  it('converges the other volumes when one fails and reports the failure', async () => {
    const other = { ...volume, id: 'shop/store/logs', dockerName: 'lw-vol-shop.store.logs', minor: 1001 };
    const r = runner({ lvs: [], luks: true, mapped: true, up: true });

    r.run.mockImplementationOnce(async () => {
      throw new Error('thin pool full');
    });

    const manager = new VolumeManager(r as never, secrets as never);

    await expect(manager.apply('n1', [volume, other])).rejects.toThrow('shop/store/data: thin pool full');
    expect(r.calls.map((c) => [c.cmd, ...c.args].join(' '))).toContain(
      `lvcreate -y --config ${VolumeManager.THIN_CHECK_CONFIG} -V 10737418240b -T loadweaver/pool -n lw-1001`,
    );
    expect(manager.byDockerName('lw-vol-shop.store.logs')).toBeDefined();
  });

  it('formats every replica with the same volume key, through a tmpfs file removed right after', async () => {
    const keys: Buffer[] = [];

    for (const node of ['n1', 'n2']) {
      const r = runner({ lvs: [], luks: false, mapped: false, up: false });

      await new VolumeManager(r as never, { fetch: jest.fn(async () => Buffer.from('k'.repeat(64))) } as never).apply(
        node,
        [volume],
      );

      const format = r.calls.find((c) => c.args[0] === 'luksFormat');
      const file = format?.args[format.args.indexOf('--volume-key-file') + 1] ?? '';

      expect(file.startsWith(join(dir, 'keys'))).toBe(true);
      await expect(readFile(file)).rejects.toThrow('ENOENT');
      keys.push(format?.volumeKey ?? Buffer.alloc(0));
    }

    expect(keys[0]).toHaveLength(64);
    expect(keys[0].equals(keys[1])).toBe(true);
    expect(keys[0].equals(volumeKey(Buffer.from('k'.repeat(64)), volume.id))).toBe(true);
    // Bound to the volume: another volume with the same material gets another key.
    expect(volumeKey(Buffer.from('k'.repeat(64)), 'shop/store/logs').equals(keys[0])).toBe(false);
  });

  it('uses --master-key-file with cryptsetup before 2.5', async () => {
    const r = runner({
      lvs: [],
      luks: false,
      mapped: false,
      up: false,
      cryptsetupHelp: '      --master-key-file=STRING          Read the volume (master) key from file.',
    });

    await new VolumeManager(r as never, secrets as never).apply('n1', [volume]);

    expect(r.calls.find((c) => c.args[0] === 'luksFormat')?.args).toContain('--master-key-file');
  });

  it('refuses to write a volume key outside tmpfs', async () => {
    jest.restoreAllMocks();
    // The source tree is on a disk file system (the temp dir may well be tmpfs).
    process.env['LOADWEAVER_KEY_TMPFS'] = __dirname;

    const r = runner({ lvs: [], luks: false, mapped: false, up: false });

    await expect(new VolumeManager(r as never, secrets as never).apply('n1', [volume])).rejects.toThrow(
      'is not tmpfs; refusing to write a volume key there',
    );
    expect(r.calls.some((c) => c.args[0] === 'luksFormat')).toBe(false);
  });

  it('forgets the peer slot of a replica that moved away after adjusting, on the remaining replicas', async () => {
    await writeFile(join(dir, 'lw-1000.res'), renderDrbdResource(volume));

    // b1 (node-id 2) moved to c1, which gets a new node id.
    const moved: VolumeAssignment = {
      ...volume,
      replicas: [...volume.replicas.slice(0, 2), { node: 'c1', nodeId: 3, address: '10.93.0.4' }],
      connections: [
        { a: 'n1', b: 'n2', protocol: 'C' },
        { a: 'n1', b: 'c1', protocol: 'A' },
        { a: 'n2', b: 'c1', protocol: 'A' },
      ],
    };
    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true });

    await new VolumeManager(r as never, secrets as never).apply('n2', [moved]);

    const commands = r.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands.slice(-2)).toEqual(['drbdadm adjust lw-1000', 'drbdsetup forget-peer lw-1000 2']);
    // Nothing to forget once the config is current.
    const again = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true });

    await new VolumeManager(again as never, secrets as never).apply('n2', [moved]);
    expect(again.calls.some((c) => c.args[0] === 'forget-peer')).toBe(false);
  });

  it('retries a failed adjust and the forget-peer after it on the next apply, although the config is current', async () => {
    await writeFile(join(dir, 'lw-1000.res'), renderDrbdResource(volume));

    const shrunk: VolumeAssignment = { ...volume, replicas: volume.replicas.slice(0, 2) };
    const state = { lvs: ['lw-1000'], luks: true, mapped: true, up: true, adjustFails: 1 };
    const r = runner(state);

    await expect(new VolumeManager(r as never, secrets as never).apply('n1', [shrunk])).rejects.toThrow(
      'adjust failed',
    );
    expect(r.calls.some((c) => c.args[0] === 'forget-peer')).toBe(false);
    // The new config is on disk already; the pending marker remembers the adjust and the peer to forget.
    expect(await readFile(join(dir, 'lw-1000.res'), 'utf8')).toBe(renderDrbdResource(shrunk));

    const again = runner(state);

    await new VolumeManager(again as never, secrets as never).apply('n1', [shrunk]);

    const commands = again.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands.slice(-2)).toEqual(['drbdadm adjust lw-1000', 'drbdsetup forget-peer lw-1000 2']);

    // Done: nothing pending any more.
    const third = runner(state);

    await new VolumeManager(third as never, secrets as never).apply('n1', [shrunk]);
    expect(third.calls.some((c) => c.args[0] === 'adjust' || c.args[0] === 'forget-peer')).toBe(false);
  });

  it('keeps converging when forget-peer fails, and never forgets peers that only changed their host name', async () => {
    await writeFile(join(dir, 'lw-1000.res'), renderDrbdResource({ ...volume, replicas: volume.replicas.slice(0, 2) }));

    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true, forgetFails: true });
    const hosted = { ...volume, replicas: volume.replicas.slice(0, 2).map((p) => ({ ...p, host: `${p.node}.lan` })) };

    // Renamed hosts keep their node ids: adjust, no forget.
    await new VolumeManager(r as never, secrets as never).apply('n1', [hosted]);
    expect(r.calls.some((c) => c.args[0] === 'forget-peer')).toBe(false);

    await writeFile(join(dir, 'lw-1000.res'), renderDrbdResource(volume));
    await expect(
      new VolumeManager(r as never, secrets as never).apply('n1', [
        { ...volume, replicas: volume.replicas.slice(0, 2) },
      ]),
    ).resolves.toBe(true);
    expect(r.calls.filter((c) => c.args[0] === 'forget-peer').map((c) => c.args.join(' '))).toEqual([
      'forget-peer lw-1000 2',
    ]);
  });

  it('keeps a failed forget-peer pending, reports it and retries it on the next reconcile until it succeeds', async () => {
    await writeFile(join(dir, 'lw-1000.res'), renderDrbdResource(volume));

    const shrunk: VolumeAssignment = { ...volume, replicas: volume.replicas.slice(0, 2) };
    const state = { lvs: ['lw-1000'], luks: true, mapped: true, up: true, forgetFails: true };
    const manager = new VolumeManager(runner(state) as never, secrets as never);

    expect(manager.forgetPeerWarning()).toBeUndefined();
    await expect(manager.apply('n1', [shrunk])).resolves.toBe(true);
    // The adjust is done, only the peer to forget stays pending.
    expect(JSON.parse(await readFile(join(dir, 'lw-1000.res.pending'), 'utf8'))).toEqual({
      adjust: false,
      forget: [2],
    });
    expect(manager.forgetPeerWarning()).toMatch(
      /^DRBD forget-peer pending, retried on the next reconcile: shop\/store\/data \(node-id 2: drbdsetup forget-peer lw-1000 2 failed/,
    );

    // Still failing: retried without another adjust, still pending.
    const second = runner(state);

    await new VolumeManager(second as never, secrets as never).apply('n1', [shrunk]);
    expect(
      second.calls.filter((c) => c.args[0] === 'adjust' || c.args[0] === 'forget-peer').map((c) => c.args.join(' ')),
    ).toEqual(['forget-peer lw-1000 2']);

    // DRBD accepts it now: the marker and the warning are gone.
    state.forgetFails = false;
    const third = runner(state);

    (manager as unknown as { commands: unknown }).commands = third;
    await manager.apply('n1', [shrunk]);
    expect(third.calls.filter((c) => c.args[0] === 'forget-peer').map((c) => c.args.join(' '))).toEqual([
      'forget-peer lw-1000 2',
    ]);
    await expect(readFile(join(dir, 'lw-1000.res.pending'), 'utf8')).rejects.toThrow();
    expect(manager.forgetPeerWarning()).toBeUndefined();

    const fourth = runner(state);

    await new VolumeManager(fourth as never, secrets as never).apply('n1', [shrunk]);
    expect(fourth.calls.some((c) => c.args[0] === 'forget-peer')).toBe(false);
  });

  it('treats a slot DRBD no longer has as forgotten and drops a pending forget once the peer is a replica again', async () => {
    await writeFile(join(dir, 'lw-1000.res'), renderDrbdResource({ ...volume, replicas: volume.replicas.slice(0, 2) }));
    // Left behind by an interrupted run whose forget-peer had already succeeded.
    await writeFile(join(dir, 'lw-1000.res.pending'), JSON.stringify({ adjust: false, forget: [2] }));

    const shrunk: VolumeAssignment = { ...volume, replicas: volume.replicas.slice(0, 2) };
    const r = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true, forgetUnknown: true });
    const manager = new VolumeManager(r as never, secrets as never);

    await manager.apply('n1', [shrunk]);
    expect(r.calls.filter((c) => c.args[0] === 'forget-peer')).toHaveLength(1);
    expect(manager.forgetPeerWarning()).toBeUndefined();
    await expect(readFile(join(dir, 'lw-1000.res.pending'), 'utf8')).rejects.toThrow();

    // Node-id 2 holds a replica again: a stale pending forget for it is never run.
    await writeFile(join(dir, 'lw-1000.res.pending'), JSON.stringify({ adjust: false, forget: [2] }));

    const back = runner({ lvs: ['lw-1000'], luks: true, mapped: true, up: true, forgetFails: true });
    const again = new VolumeManager(back as never, secrets as never);

    await again.apply('n1', [volume]);
    expect(back.calls.some((c) => c.args[0] === 'forget-peer')).toBe(false);
    expect(again.forgetPeerWarning()).toBeUndefined();
  });

  it("matches DRBD connections by the peers' host names when initialising a new volume", async () => {
    const hosted: VolumeAssignment = {
      ...volume,
      replicas: volume.replicas.map((p) => ({ ...p, host: p.node === 'n1' ? 'host-a' : p.node })),
    };
    const r = runner({
      lvs: ['lw-1000'],
      luks: true,
      mapped: true,
      up: true,
      fs: '',
      disk: 'Inconsistent',
      peers: { n2: 'Inconsistent', b1: 'Inconsistent' },
    });
    const manager = new VolumeManager(r as never, secrets as never);

    await manager.apply('n1', [hosted]);
    await manager.mount('lw-vol-shop.store.data');

    expect(r.calls.map((c) => [c.cmd, ...c.args].join(' '))).toContain(
      'drbdadm new-current-uuid --clear-bitmap lw-1000/0',
    );
    expect(await readFile(join(dir, 'lw-1000.res'), 'utf8')).toContain('on "host-a" { node-id 0;');
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
