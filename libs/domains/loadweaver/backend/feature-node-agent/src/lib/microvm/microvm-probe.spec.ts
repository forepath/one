import { readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { CommandError } from '../host/command-runner';
import { tarArchive } from '../test-fixtures';
import { MicrovmProbe, PROBE_NETWORK, probeContainerOptions, probeSpec } from './microvm-probe';

const launcher = 'ghcr.io/forepath/microvm-launcher:latest';

describe('microVM boot probe (3.35)', () => {
  let dir: string;
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- the module object itself is spied (CommonJS under jest)
  const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-mvprobe-'));
    jest.spyOn(fsPromises, 'chown').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a generic launcher labelled as a probe only, on the probe network, without restarts', () => {
    const spec = probeSpec(launcher);
    const options = probeContainerOptions(spec, { runDir: '/run/x', merged: '/probe/root' }, 'lw-probe-microvm-1');

    expect(options.name).toBe('lw-probe-microvm-1');
    expect(options.Labels).toEqual({ 'loadweaver.com/probe': '1', 'loadweaver.com/microvm': 'generic' });
    expect(options.HostConfig?.RestartPolicy).toEqual({ Name: 'no' });
    expect(options.HostConfig?.NetworkMode).toBe(PROBE_NETWORK);
    expect(options.Entrypoint).toEqual(['/usr/bin/tini', '--', '/usr/lib/agenstra-microvm/launch-generic']);
    expect(spec.microvm?.process?.cmd[0]).toContain("trap 'exit 0' TERM");
  });

  function setup(overrides: { available?: boolean; execThree?: number; exitCode?: string } = {}) {
    const root = join(dir, 'vmroot');
    let probeRoot = '';
    const runs: string[] = [];
    const commands = {
      json: jest.fn(async () => [{ ifname: 'lwprobe0', addr_info: [] }]),
      run: jest.fn(async (command: string, args: string[]) => {
        runs.push([command, ...args].join(' '));

        if (command === 'docker' && args[0] === 'logs')
          return { stdout: 'lw-probe-stdout\n', stderr: 'lw-probe-stderr\n' };

        if (command === 'docker' && args[0] === 'inspect')
          return { stdout: args[2].includes('ExitCode') ? `${overrides.exitCode ?? '0'}\n` : 'true\n', stderr: '' };

        if (command === 'docker' && args[0] === 'exec') {
          const script = args[args.length - 1];

          if (script === 'exit 3') throw new CommandError('docker', args, overrides.execThree ?? 3, '');

          if (script.includes('lw-probe-x')) await writeFile(join(probeRoot, 'lw-probe-x'), 'coherent\n');
        }

        return { stdout: '', stderr: '' };
      }),
    };
    const created: unknown[] = [];
    const docker = {
      listNetworks: jest.fn(async () => []),
      createNetwork: jest.fn(async () => undefined),
      createContainer: jest.fn(async (options: { Image: string }) => {
        created.push(options);

        return {
          id: `id-${created.length}`,
          export: async () => Readable.from([tarArchive([])]),
          remove: jest.fn(async () => undefined),
          start: jest.fn(async () => undefined),
        };
      }),
    };
    const rootfs = {
      paths: { root },
      available: jest.fn(async () => ({ unpackCache: overrides.available ?? true, thinPool: false })),
    };
    const network = { attach: jest.fn(async () => true) };
    const probe = new MicrovmProbe(commands as never, docker as never, rootfs as never, network as never);

    probe.sleep = async () => undefined;
    probe.runtimeDir = () => join(dir, 'run');

    // The guest root of this run, for the coherence check.
    docker.createContainer.mockImplementationOnce(async (options: { Image: string }) => {
      created.push(options);
      probeRoot = readdirSync(join(root, 'probe')).map((d) => join(root, 'probe', d))[0];

      return {
        id: 'shell',
        export: async () => Readable.from([tarArchive([])]),
        remove: jest.fn(async () => undefined),
        start: jest.fn(async () => undefined),
      };
    });

    return { probe, runs, docker, network, created };
  }

  it('boots, execs (0 / 3), checks coherence, ICMP and a clean stop', async () => {
    const { probe, runs, docker, network } = setup();

    expect(await probe.run(launcher, 'node-shell:1')).toEqual({ ok: true, unpackCache: true, thinPool: false });
    expect(docker.createNetwork).toHaveBeenCalledWith(expect.objectContaining({ Name: PROBE_NETWORK, Internal: true }));
    expect(network.attach).toHaveBeenCalledWith('id-2', expect.objectContaining({ id: 'lw-probe/microvm/probe/0' }));
    expect(runs).toContain('ip addr add 169.254.1.1/32 dev lwprobe0');
    expect(
      runs.some((r) =>
        /^docker exec lw-probe-microvm-\w+ \/usr\/lib\/agenstra-microvm\/vm-exec -- \/bin\/true$/.test(r),
      ),
    ).toBe(true);
    expect(runs).toContain('ping -c 1 -W 2 192.0.2.2');
    expect(runs.some((r) => /^docker stop -t 30 lw-probe-microvm-/.test(r))).toBe(true);
    expect(runs[runs.length - 1]).toMatch(/^docker rm -f lw-probe-microvm-/);
  });

  it('fails with the reason code when a step fails, and always cleans up', async () => {
    const wrongExit = setup({ execThree: 1 });

    expect(await wrongExit.probe.run(launcher, 'node-shell:1')).toMatchObject({
      ok: false,
      reasonCode: 'E_MICROVM_BOOT_FAILED',
      reason: 'vm-exec exit code 1, expected 3',
    });
    expect(wrongExit.runs[wrongExit.runs.length - 1]).toMatch(/^docker rm -f /);

    expect(await setup({ exitCode: '143' }).probe.run(launcher, 'node-shell:1')).toMatchObject({
      ok: false,
      reason: 'the probe microVM stopped with status 143',
    });
    expect(await setup({ available: false }).probe.run(launcher, 'node-shell:1')).toMatchObject({
      ok: false,
      reasonCode: 'E_MICROVM_BOOT_FAILED',
      reason: expect.stringMatching(/unpack cache/),
    });
    expect(await setup().probe.run(launcher, null)).toMatchObject({
      ok: false,
      reasonCode: 'E_PROBE_IMAGE_UNAVAILABLE',
    });
  });
});
