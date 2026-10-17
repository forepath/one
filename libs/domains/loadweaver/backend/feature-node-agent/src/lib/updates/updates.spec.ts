import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NodeComponents } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  buildManifest,
  canonicalJson,
  COMPONENT_IMAGES,
  generateReleaseKeyPair,
  signManifest,
  type ReleaseManifest,
} from '@forepath/loadweaver/shared/util-release';

import { CommandError } from '../host/command-runner';
import { downloadVerified } from './artifact-download';
import { EnvoyHandover, envoyAdminSocketName } from './envoy-handover';
import { aptOptions, aptPreferences, aptSourcesList, hostUpdateScript, rebootRequired } from './host-commands';
import { OsUpdateManager } from './os-update.manager';
import { ManagedContainers } from '../host/managed-containers';
import {
  clusterImageFor,
  clusterImageRepositories,
  componentImage,
  imageOverrides,
  releaseImagesVersion,
  setClusterImageRouting,
  setReleaseImages,
} from './release-images';
import { patroniSwitchover } from './patroni';
import { rollbackScript, SelfUpdater, swapScript } from './self-update';
import { UpdateActions } from './update-actions';
import { componentOfContainer, replicationOf, UpdatesService } from './updates.service';

const KEY = generateReleaseKeyPair();
const AGENT = Buffer.from('#!/agent 3.5.0\n'.repeat(32));
const AGENT_SHA = createHash('sha256').update(AGENT).digest('hex');

function manifestOf(version = '3.5.0'): ReleaseManifest {
  return buildManifest({
    version,
    channel: 'stable',
    created: '2026-10-19T00:00:00.000Z',
    images: {
      'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:${version}@sha256:${'c'.repeat(64)}`,
      envoy: `docker.io/envoyproxy/envoy:v1.41.0@sha256:${'e'.repeat(64)}`,
    },
    agentBinaries: {
      amd64: { path: 'artifacts/bin/loadweaver-agent-linux-amd64', sha256: AGENT_SHA, size: AGENT.length },
    },
  });
}

function components(
  manifest: ReleaseManifest,
  extra: Partial<NodeComponents> = {},
  key = KEY.privateKeyPem,
): NodeComponents {
  const bytes = canonicalJson(manifest);

  return {
    release: manifest.version,
    manifest: bytes,
    signature: JSON.stringify(signManifest(Buffer.from(bytes), key)),
    artifactBase: '/api/updates/artifacts',
    ...extra,
  };
}

function fakeCommands(handler: (cmd: string, args: readonly string[]) => string | Error = () => '') {
  const calls: { cmd: string; args: string[] }[] = [];

  return {
    calls,
    run: jest.fn(async (cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args: [...args] });

      const out = handler(cmd, args);

      if (out instanceof Error) throw out;

      return { stdout: out, stderr: '' };
    }),
  };
}

describe('release images (3.26)', () => {
  afterEach(() => setReleaseImages(null));

  it('prefers a development override, then the release, then the build pins', () => {
    expect(componentImage('envoy', {})).toBe(COMPONENT_IMAGES.envoy);
    setReleaseImages(manifestOf());
    expect(releaseImagesVersion()).toBe('3.5.0');
    expect(componentImage('envoy', {})).toBe(`docker.io/envoyproxy/envoy:v1.41.0@sha256:${'e'.repeat(64)}`);
    expect(componentImage('etcd', {})).toBe(COMPONENT_IMAGES.etcd);
    expect(componentImage('envoy', { LOADWEAVER_ENVOY_IMAGE: 'dev/envoy:x' })).toBe('dev/envoy:x');
    expect(imageOverrides({ LOADWEAVER_ENVOY_IMAGE: 'dev/envoy:x', LOADWEAVER_QUEUE_IMAGE: ' ' })).toEqual(['envoy']);
  });
});

describe('release images from the cluster registry (air-gapped, 3.26)', () => {
  const client = { privateHost: 'registry.lw', routerPort: 7479, mirrors: [] };
  const envoy = `docker.io/envoyproxy/envoy:v1.41.0@sha256:${'e'.repeat(64)}`;
  const routed = `127.0.0.1:7479/registry.lw/lw-system/envoy@sha256:${'e'.repeat(64)}`;

  afterEach(() => {
    setReleaseImages(null);
    setClusterImageRouting(undefined, []);
  });

  it('maps a release image to its lw-system copy by digest, only for imported components', () => {
    setReleaseImages(manifestOf());
    expect(clusterImageFor(envoy)).toBeNull();
    setClusterImageRouting(client as never, ['envoy']);
    expect(clusterImageFor(envoy)).toBe(routed);
    expect(clusterImageFor(COMPONENT_IMAGES.etcd)).toBeNull();
    expect(clusterImageFor('busybox:latest')).toBeNull();
    expect(clusterImageRepositories()).toEqual(['lw-system/envoy']);
  });

  it('pulls upstream first, the cluster copy when upstream fails, and creates from what it pulled', async () => {
    setReleaseImages(manifestOf());
    setClusterImageRouting(client as never, ['envoy']);

    const pulled: string[] = [];
    const created: string[] = [];
    const docker = {
      listImages: async () => [],
      pull: async (image: string) => {
        pulled.push(image);

        if (!image.startsWith('127.0.0.1')) throw new Error('upstream unreachable');

        return {};
      },
      modem: { followProgress: (_s: unknown, done: (e: Error | null) => void) => done(null) },
      getContainer: () => ({ inspect: async () => Promise.reject(new Error('missing')) }),
      createContainer: async (options: { Image: string }) => {
        created.push(options.Image);

        return { start: async () => undefined };
      },
    };
    const containers = new ManagedContainers(docker as never);

    await containers.ensure({
      name: 'lw-ingress',
      image: envoy,
      env: {},
      binds: [],
      memoryBytes: 1,
      hash: 'h',
      component: 'ingress',
    });
    expect(pulled).toEqual([envoy, routed]);
    expect(created).toEqual([routed]);
    await expect(containers.pull('docker.io/library/other@sha256:' + '1'.repeat(64))).rejects.toThrow(
      'upstream unreachable',
    );
  });
});

describe('host update commands (3.26)', () => {
  it('points apt at the agent configuration and the frozen snapshot only', () => {
    const options = aptOptions({ dir: '/var/lib/loadweaver/apt' });

    expect(options).toContain('Dir::Etc::sourcelist=/var/lib/loadweaver/apt/sources.list');
    expect(options).toContain('Dir::Etc::sourceparts=-');
    expect(options).toContain('Acquire::Check-Valid-Until=false');
    expect(() => aptOptions({ dir: '/tmp/$(reboot)' })).toThrow(/unsafe/);
    expect(
      aptSourcesList('https://cp.example.com/', '/api/updates/apt/s-1', [
        {
          name: 'debian-trixie',
          suites: ['trixie', 'trixie-updates'],
          components: ['main'],
          keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
        },
      ]),
    ).toBe(
      [
        'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://cp.example.com/api/updates/apt/s-1/debian-trixie trixie main',
        'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://cp.example.com/api/updates/apt/s-1/debian-trixie trixie-updates main',
        '',
      ].join('\n'),
    );
    expect(() =>
      aptSourcesList('https://cp', '/api/x', [
        { name: 'a', suites: ['x; reboot'], components: ['main'], keyring: '/etc/apt/keyrings/a.gpg' },
      ]),
    ).toThrow(/unsafe suite/);
    expect(aptPreferences({ 'drbd-utils': '9.22.0-1.1', bird2: '2.17.5-0+deb13u1' })).toBe(
      'Package: bird2\nPin: version 2.17.5-0+deb13u1\nPin-Priority: 1001\n\nPackage: drbd-utils\nPin: version 9.22.0-1.1\nPin-Priority: 1001\n',
    );
  });

  it('writes one script: packages, BIRD graceful restart, gVisor, DRBD for the next kernel, a result file', () => {
    const script = hostUpdateScript({
      apt: { dir: '/var/lib/loadweaver/apt' },
      upgrade: true,
      install: { bird2: '2.17.5-0+deb13u1', 'docker-ce': '5:29.9.1-1~debian.13~trixie' },
      birdGracefulRestart: true,
      gvisor: {
        release: '20261012.0',
        tarball: '/var/lib/loadweaver/updates/files/g.tar.bz2',
        script: '/var/lib/loadweaver/updates/files/g.sh',
      },
      drbd: {
        version: '9.2.20',
        prebuilt: { '6.12.48+deb13-amd64': '/var/lib/loadweaver/updates/files/drbd-k.tar.gz' },
        source: '/var/lib/loadweaver/updates/files/drbd.tar.gz',
        compat: {
          // Two distinct compat.h for one kernel release (e.g. Ubuntu 22.04 HWE and 24.04): both go into the cache.
          '6.12.113+deb13-cloud-amd64': [
            { file: '/var/lib/loadweaver/updates/files/drbd-compat-k.tar.gz', md5: '0123456789abcdef0123456789abcdef' },
            {
              file: '/var/lib/loadweaver/updates/files/drbd-compat-k2.tar.gz',
              md5: 'fedcba9876543210fedcba9876543210',
            },
          ],
        },
        signed: false,
      },
      resultFile: '/var/lib/loadweaver/updates/host-1.result',
    });

    expect(script).toMatch(/'apt-get' .* update\n/);
    expect(script).toContain('birdc graceful restart');
    expect(script).toContain('-y dist-upgrade');
    expect(script).toContain(
      "--allow-downgrades --no-install-recommends install 'bird2=2.17.5-0+deb13u1' 'docker-ce=5:29.9.1-1~debian.13~trixie'",
    );
    expect(script).toContain("bash '/var/lib/loadweaver/updates/files/g.sh' install");
    expect(script).toContain('KVER=$(ls /lib/modules | sort -V | tail -1)');
    expect(script).toContain("'6.12.48+deb13-amd64') mkdir -p");
    expect(script).toContain('mokutil --sb-state');
    // Built offline: the release's compat patch for the kernel goes into DRBD's cache, SPAAS is off.
    expect(script).toContain(
      `        '6.12.113+deb13-cloud-amd64') compat=('/var/lib/loadweaver/updates/files/drbd-compat-k.tar.gz' '/var/lib/loadweaver/updates/files/drbd-compat-k2.tar.gz'); md5s='0123456789abcdef0123456789abcdef fedcba9876543210fedcba9876543210' ;;`,
    );
    expect(script).toContain(
      'for f in "${compat[@]+"${compat[@]}"}"; do tar -xzf "$f" -C "$src/drbd/drbd-kernel-compat" --no-same-owner -m; done',
    );
    expect(script).toContain(
      'for m in $md5s; do touch "$src/drbd/drbd-kernel-compat/cocci_cache/$m/compat.patch"; done',
    );
    expect(script).toContain(
      'if ! make -C "$src" KDIR="/lib/modules/$KVER/build" SPAAS=false -j"$(nproc)" > "$log" 2>&1; then',
    );
    expect(script).toContain(
      'make -C "$src" KDIR="/lib/modules/$KVER/build" SPAAS=false install >> "$log" 2>&1 || { tail -n 40 "$log" >&2; lw_fail "DRBD 9.2.20: install for $KVER failed (log $log)"; }',
    );
    expect(script.split('\n').filter((l) => l.includes('make -C') && !l.includes('SPAAS=false'))).toEqual([]);
    expect(script).toContain("differs from the release's pre-generated ones ($md5s); no offline build");
    expect(script).toContain('log="/var/log/loadweaver-drbd-build-$KVER.log"');
    // Every kernel the upgrade brings is checked for a prebuilt module / compat patch before the dist-upgrade.
    expect(script).toContain("-s dist-upgrade | sed -nE 's/^Inst linux-image-(unsigned-)?([0-9][^ ]*) .*/\\2/p'); do");
    expect(script.indexOf('-s dist-upgrade')).toBeLessThan(script.indexOf('-y dist-upgrade'));
    expect(script).toContain("    '6.12.113+deb13-cloud-amd64'|'6.12.48+deb13-amd64') ;;");
    // The module must be there for the next boot's kernel before the update counts as done (checked after depmod).
    expect(script).toContain(
      `  depmod -a "$KVER"\n  if [ "$(modinfo -k "$KVER" -F version drbd 2>/dev/null || true)" != '9.2.20' ]; then\n    lw_fail "DRBD 9.2.20 is not installed for $KVER"\n  fi\nfi\n`,
    );
    expect(spawnSync('/bin/bash', ['-n'], { input: script }).status).toBe(0);
    expect(script.trim().endsWith("echo ok > '/var/lib/loadweaver/updates/host-1.result'")).toBe(true);
    expect(script).not.toContain('reboot');
    expect(() =>
      hostUpdateScript({
        apt: { dir: '/a' },
        upgrade: false,
        install: { 'x;rm': '1' },
        birdGracefulRestart: false,
        resultFile: '/r',
      }),
    ).toThrow();
  });

  describe('DRBD offline builds (air-gapped, no SPAAS)', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'lw-host-script-'));
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const NEXT = '6.12.113+deb13-cloud-amd64';
    /** Runs the script with a fake apt-get whose simulated dist-upgrade brings kernel NEXT; returns result + apt calls. */
    const run = (
      compat: Record<string, { file: string; md5: string }[]>,
      prebuilt: Record<string, string> = {},
      spaas?: { reachable: boolean },
    ) => {
      const bin = join(dir, 'bin');
      const calls = join(dir, 'apt-calls');

      execFileSync('mkdir', ['-p', bin]);
      rmSync(calls, { force: true });
      // A fake curl standing in for the SPAAS reachability check (records its calls next to apt's).
      writeFileSync(
        join(bin, 'curl'),
        `#!/bin/bash\necho "curl $*" >> ${calls}\nexit ${spaas?.reachable === false ? 6 : 0}\n`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(bin, 'apt-get'),
        `#!/bin/bash\necho "$*" >> ${calls}\ncase " $* " in *" -s dist-upgrade "*) echo "Inst linux-image-${NEXT} (6.12.113-1 Debian-Security:13/stable-security [amd64])"; echo "Inst linux-image-cloud-amd64 [6.12.107-1] (6.12.113-1 Debian-Security:13/stable-security [amd64])"; echo "Inst bird2 [2.17.4-1] (2.17.5-0+deb13u1 Debian:13 [amd64])" ;; *" -y dist-upgrade "*) exit 7 ;; esac\n`,
        { mode: 0o755 },
      );

      const script = join(dir, 'host.sh');

      writeFileSync(
        script,
        hostUpdateScript({
          apt: { dir: join(dir, 'apt') },
          upgrade: true,
          install: {},
          birdGracefulRestart: false,
          drbd: {
            version: '9.2.20',
            prebuilt,
            source: join(dir, 'drbd.tar.gz'),
            compat,
            signed: false,
            ...(spaas ? { spaas: true } : {}),
          },
          resultFile: join(dir, 'result'),
        }),
      );
      spawnSync('/bin/bash', [script], { env: { ...process.env, PATH: `${bin}:${process.env['PATH']}` } });

      return {
        result: readFileSync(join(dir, 'result'), 'utf8').trim(),
        apt: readFileSync(calls, 'utf8').trim().split('\n'),
      };
    };

    it('fails before anything changes when the upgrade brings a kernel without a compat patch or prebuilt module', () => {
      const { result, apt } = run({ '6.12.107+deb13-cloud-amd64': [{ file: '/x.tar.gz', md5: 'a'.repeat(32) }] });

      expect(result).toBe(
        `failed: DRBD 9.2.20: the release ships neither a prebuilt module nor a compat patch for kernel ${NEXT} (the upgrade would install it; DRBD builds offline); nothing was changed`,
      );
      // Only the index update and the simulation ran: no dist-upgrade, no install.
      expect(apt.map((a) => a.split(' ').slice(-2).join(' '))).toEqual(['Dpkg::Use-Pty=0 update', '-s dist-upgrade']);
    });

    it('goes on to the dist-upgrade when the kernel is covered (compat patch, or a prebuilt module)', () => {
      expect(run({ [NEXT]: [{ file: '/x.tar.gz', md5: 'a'.repeat(32) }] }).apt.pop()).toMatch(/ -y dist-upgrade$/);
      expect(run({}, { [NEXT]: '/m.tar.gz' }).apt.pop()).toMatch(/ -y dist-upgrade$/);
    });

    it('online cluster: an uncovered kernel goes on to the dist-upgrade when SPAAS is reachable, refused before any change when not', () => {
      const ok = run(
        { '6.12.107+deb13-cloud-amd64': [{ file: '/x.tar.gz', md5: 'a'.repeat(32) }] },
        {},
        { reachable: true },
      );

      expect(ok.apt.filter((c) => c.startsWith('curl '))).toEqual([
        'curl -fsS --max-time 30 -o /dev/null https://spaas.drbd.io/api/v1/hello',
      ]);
      expect(ok.apt.pop()).toMatch(/ -y dist-upgrade$/);

      const unreachable = run({}, {}, { reachable: false });

      expect(unreachable.result).toBe(
        `failed: DRBD 9.2.20: the release ships neither a prebuilt module nor a compat patch for kernel ${NEXT} and LINBIT's SPAAS is unreachable (the upgrade would install it); nothing was changed`,
      );
      expect(unreachable.apt.some((c) => / -y dist-upgrade$/.test(c))).toBe(false);
      // A covered kernel needs no SPAAS (not even the check).
      expect(
        run({ [NEXT]: [{ file: '/x.tar.gz', md5: 'a'.repeat(32) }] }, {}, { reachable: false }).apt.some((c) =>
          c.startsWith('curl '),
        ),
      ).toBe(false);
    });

    it('online cluster: builds uncovered kernels (and mismatching compat.h) with SPAAS, still checking the module before the reboot', () => {
      const script = hostUpdateScript({
        apt: { dir: '/a' },
        upgrade: true,
        install: {},
        birdGracefulRestart: false,
        drbd: {
          version: '9.2.20',
          prebuilt: {},
          source: '/s.tar.gz',
          compat: { [NEXT]: [{ file: '/x.tar.gz', md5: 'a'.repeat(32) }] },
          signed: false,
          spaas: true,
        },
        resultFile: '/r',
      });

      expect(script).toContain(
        `        *) compat=(); md5s=''; echo "DRBD 9.2.20: no bundled compat patch for $KVER; building with LINBIT's SPAAS (online cluster)" >&2 ;;`,
      );
      expect(script).toContain(`        '${NEXT}') compat=('/x.tar.gz'); md5s='${'a'.repeat(32)}' ;;`);
      expect(script.split('\n').filter((l) => l.includes('make -C') && !l.includes('SPAAS=true'))).toEqual([]);
      expect(script).not.toContain('SPAAS=false');
      expect(script).not.toContain('no offline build');
      expect(script).not.toContain('(DRBD builds offline)');
      expect(script).toContain(`    lw_fail "DRBD 9.2.20 is not installed for $KVER"`);
      expect(script.indexOf('-s dist-upgrade')).toBeLessThan(script.indexOf('-y dist-upgrade'));
      expect(spawnSync('/bin/bash', ['-n'], { input: script }).status).toBe(0);

      // Without a source there is nothing to build: SPAAS changes nothing (offline refusal as before).
      const noSource = hostUpdateScript({
        apt: { dir: '/a' },
        upgrade: true,
        install: {},
        birdGracefulRestart: false,
        drbd: { version: '9.2.20', prebuilt: {}, signed: false, spaas: true },
        resultFile: '/r',
      });

      expect(noSource).not.toContain('spaas.drbd.io');
      expect(noSource).toContain('(the upgrade would install it; DRBD builds offline); nothing was changed');
    });

    it('ignores compat patches without a source to apply them to', () => {
      const script = hostUpdateScript({
        apt: { dir: '/a' },
        upgrade: true,
        install: {},
        birdGracefulRestart: false,
        drbd: {
          version: '9.2.20',
          prebuilt: {},
          compat: { [NEXT]: [{ file: '/x', md5: 'a'.repeat(32) }] },
          signed: false,
        },
        resultFile: '/r',
      });

      expect(script).not.toContain(`'${NEXT}'`);
      expect(script).toContain('lw_fail "no DRBD 9.2.20 module for $KVER"');
      expect(() =>
        hostUpdateScript({
          apt: { dir: '/a' },
          upgrade: false,
          install: {},
          birdGracefulRestart: false,
          drbd: {
            version: '9.2.20',
            prebuilt: {},
            source: '/s',
            compat: { [NEXT]: [{ file: '/x', md5: 'x;y' }] },
            signed: false,
          },
          resultFile: '/r',
        }),
      ).toThrow('unsafe MD5');
    });
  });

  it('knows when the next boot runs another kernel', () => {
    expect(rebootRequired('6.12.48+deb13-amd64', ['6.12.48+deb13-amd64'], false)).toBe(false);
    expect(rebootRequired('6.12.48+deb13-amd64', ['6.12.48+deb13-amd64', '6.12.57+deb13-amd64'], false)).toBe(true);
    expect(rebootRequired('6.12.9-amd64', ['6.12.9-amd64', '6.12.10-amd64'], false)).toBe(true);
    expect(rebootRequired('6.12.9', ['6.12.9'], true)).toBe(true);
  });
});

describe('agent self-update (3.26)', () => {
  let dir: string;
  const config = () => ({
    binary: '/usr/local/bin/loadweaver-agent',
    unit: 'loadweaver-agent',
    dir: join(dir, 'updates'),
  });
  const fetchAgent = (body = AGENT) => jest.fn(async () => new Response(new Uint8Array(body)));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lw-self-update-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('swaps through transient units with a rollback timer, keeping the previous binary', async () => {
    const commands = fakeCommands();
    const actions = new UpdateActions(config().dir);
    const updater = new SelfUpdater(config(), commands as never, actions, '3.4.0', fetchAgent(), {
      INVOCATION_ID: 'x',
    });

    expect(await updater.ensure(manifestOf(), 'amd64', 'https://cp.example.com', '/api/updates/artifacts')).toBe(true);
    expect(readFileSync(join(config().dir, 'loadweaver-agent-3.5.0')).equals(AGENT)).toBe(true);
    expect(commands.calls.map((c) => c.args[0])).toEqual([
      expect.stringMatching(/^--unit=loadweaver-agent-rollback-/),
      expect.stringMatching(/^--unit=loadweaver-agent-update-/),
    ]);
    expect(commands.calls[0].args).toContain('--on-active=300');
    expect((await actions.get('self-update:3.5.0'))?.phase).toBe('restarting');
    expect(JSON.parse(readFileSync(join(config().dir, 'self-update.json'), 'utf8'))).toMatchObject({
      version: '3.5.0',
      from: '3.4.0',
    });

    // The new agent confirms once it applied the control plane's state: the timer stops, the marker goes.
    const confirmed = new SelfUpdater(config(), commands as never, actions, '3.5.0', fetchAgent(), {});

    await confirmed.confirm();
    expect(commands.calls.at(-1)?.args).toEqual([
      'stop',
      expect.stringMatching(/^loadweaver-agent-rollback-.*\.timer$/),
    ]);
    expect(existsSync(join(config().dir, 'self-update.json'))).toBe(false);
    expect((await actions.get('self-update:3.5.0'))?.phase).toBe('done');
  });

  it('reports a rollback when the old agent comes back, and never retries that version', async () => {
    const commands = fakeCommands();
    const actions = new UpdateActions(config().dir);

    await new SelfUpdater(config(), commands as never, actions, '3.4.0', fetchAgent(), { INVOCATION_ID: 'x' }).ensure(
      manifestOf(),
      'amd64',
      'https://cp',
      '/api/updates/artifacts',
    );

    const old = new SelfUpdater(config(), commands as never, actions, '3.4.0', fetchAgent(), { INVOCATION_ID: 'x' });

    await old.confirm();
    expect(await actions.get('self-update:3.5.0')).toMatchObject({
      phase: 'rolled-back',
      error: expect.stringContaining('3.4.0 was restored'),
    });
    expect(await old.ensure(manifestOf(), 'amd64', 'https://cp', '/api/updates/artifacts')).toBe(false);
    // The block is the action's error, not a silent no-op (M6 review L5).
    expect(await actions.get('self-update:3.5.0')).toMatchObject({
      phase: 'rolled-back',
      error: expect.stringContaining('not retried while it stays on release 3.5.0'),
    });

    // Same release again: still blocked. Moved to another release (rollback): a later step retries once more.
    await old.clearStaleFailures('3.5.0');
    expect(await old.ensure(manifestOf(), 'amd64', 'https://cp', '/api/updates/artifacts')).toBe(false);
    await old.clearStaleFailures('3.4.0');
    expect(existsSync(join(config().dir, 'failed-3.5.0'))).toBe(false);
    expect(await old.ensure(manifestOf(), 'amd64', 'https://cp', '/api/updates/artifacts')).toBe(true);
  });

  it('refuses binaries that do not match the signed manifest, and agents outside systemd', async () => {
    const commands = fakeCommands();
    const actions = new UpdateActions(config().dir);
    const tampered = new SelfUpdater(config(), commands as never, actions, '3.4.0', fetchAgent(Buffer.from('evil')), {
      INVOCATION_ID: 'x',
    });

    expect(await tampered.ensure(manifestOf(), 'amd64', 'https://cp', '/api/updates/artifacts')).toBe(false);
    expect(await actions.get('self-update:3.5.0')).toMatchObject({
      phase: 'failed',
      error: expect.stringContaining('signed manifest'),
    });
    expect(commands.calls).toEqual([]);
    expect(existsSync(join(config().dir, 'self-update.json'))).toBe(false);

    const dev = new SelfUpdater(config(), commands as never, actions, '3.4.0', fetchAgent(), {});

    expect(await dev.ensure(manifestOf(), 'amd64', 'https://cp', '/api/updates/artifacts')).toBe(false);
    expect(await actions.get('self-update:3.5.0')).toMatchObject({ error: 'the agent does not run under systemd' });
    expect(await dev.ensure(manifestOf(), 'arm64', 'https://cp', '/api/updates/artifacts')).toBe(false);
    // Same version: nothing to do.
    expect(
      await new SelfUpdater(config(), commands as never, actions, '3.5.0', fetchAgent(), { INVOCATION_ID: 'x' }).ensure(
        manifestOf(),
        'amd64',
        'https://cp',
        '/api/x',
      ),
    ).toBe(false);
  });

  it('builds safe swap and rollback scripts', () => {
    const c = {
      binary: '/usr/local/bin/loadweaver-agent',
      unit: 'loadweaver-agent',
      dir: '/var/lib/loadweaver/updates',
    };

    expect(swapScript(c, '/var/lib/loadweaver/updates/loadweaver-agent-3.5.0')).toContain(
      "systemctl restart 'loadweaver-agent'",
    );
    expect(rollbackScript(c)).toContain("if [ -f '/var/lib/loadweaver/updates/self-update.json' ]");
    expect(() => swapScript({ ...c, unit: 'x; reboot' }, '/a')).toThrow();
    expect(() => swapScript(c, "/a'b")).toThrow();
  });

  it('downloads verified files only', async () => {
    const target = join(dir, 'f');

    await expect(downloadVerified('https://x/a', target, {}, fetchAgent(), 10)).rejects.toThrow(/no checksum/);
    await expect(downloadVerified('https://x/a', target, { sha256: AGENT_SHA }, fetchAgent(), 10)).rejects.toThrow(
      /size limit/,
    );
    await downloadVerified('https://x/a', target, { sha256: AGENT_SHA, size: AGENT.length }, fetchAgent(), 1e6);
    expect(existsSync(`${target}.part`)).toBe(false);

    // Already in place: no second download.
    const again = fetchAgent();

    await downloadVerified('https://x/a', target, { sha256: AGENT_SHA }, again, 1e6);
    expect(again).not.toHaveBeenCalled();
  });
});

describe('OS updates (3.26)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lw-os-update-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const host = {
    id: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f',
    snapshot: 's-1',
    aptBase: '/api/updates/apt/s-1',
    sources: [
      {
        name: 'debian-trixie',
        suites: ['trixie'],
        components: ['main'],
        keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
      },
    ],
    upgrade: true,
  };
  // DRBD source download: served from the bundle by checksum (manifest without bundled source → upstream URL).
  const drbdFetch = jest.fn(async () => new Response('drbd source'));

  it('installs from the snapshot in a transient unit and records the result; reboots once per token', async () => {
    const updates = join(dir, 'updates');
    const commands = fakeCommands((cmd) => {
      if (cmd === 'dpkg-query')
        return 'bird2 2.17.4-1 installed\ndocker-ce 5:29.9.0-1~debian.13~trixie installed\ncriu 4.1.1-1 deinstall\n';

      if (cmd === 'systemd-run') writeFileSync(join(updates, `host-${host.id}.result`), 'ok\n');

      return '';
    });
    const actions = new UpdateActions(updates);
    const manager = new OsUpdateManager(updates, join(dir, 'apt'), commands as never, actions, drbdFetch);
    const manifest = manifestOf();

    // gVisor / DRBD downloads are verified against the pinned checksums (covered below); this run updates packages.
    delete (manifest.components as Record<string, unknown>)['drbd'];
    delete (manifest.components as Record<string, unknown>)['gvisor'];
    await manager.run(host, manifest, 'https://cp.example.com', '/api/updates/artifacts', {
      id: 'debian',
      versionId: '13',
      arch: 'amd64',
    });

    expect(readFileSync(join(dir, 'apt', 'sources.list'), 'utf8')).toContain(
      'https://cp.example.com/api/updates/apt/s-1/debian-trixie trixie main',
    );
    expect(readFileSync(join(dir, 'apt', 'preferences'), 'utf8')).toContain(
      'Package: bird2\nPin: version 2.17.5-0+deb13u1',
    );
    // criu isn't installed: not pulled in by the pins.
    expect(readFileSync(join(dir, 'apt', 'preferences'), 'utf8')).not.toContain('criu');

    const script = readFileSync(join(updates, `host-${host.id}.sh`), 'utf8');

    expect(script).toContain('birdc graceful restart');
    expect(commands.calls.find((c) => c.cmd === 'systemd-run')?.args).toEqual([
      'loadweaver-host-update-6f1c1d2e'.replace(/^/, '--unit='),
      '--wait',
      '--collect',
      '--quiet',
      '/bin/bash',
      join(updates, `host-${host.id}.sh`),
    ]);
    expect(await actions.get(host.id)).toMatchObject({ kind: 'host', phase: 'done' });
    expect(await manager.appliedSnapshot()).toBe('s-1');

    // Runs once per id.
    await manager.run(host, manifest, 'https://cp.example.com', '/api/updates/artifacts', {
      id: 'debian',
      versionId: '13',
      arch: 'amd64',
    });
    expect(commands.calls.filter((c) => c.cmd === 'systemd-run')).toHaveLength(1);

    jest.useFakeTimers();
    expect(await manager.reboot({ ...host, reboot: '7f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f' })).toBe(true);
    expect(await manager.reboot({ ...host, reboot: '7f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f' })).toBe(false);
    jest.advanceTimersByTime(3_000);
    jest.useRealTimers();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // DRBD replicas go down cleanly first (clean metadata, peers told), then the reboot.
    expect(commands.calls.slice(-2)).toEqual([
      { cmd: 'drbdadm', args: ['down', 'all'] },
      { cmd: 'systemctl', args: ['reboot'] },
    ]);
    expect(await actions.get(host.id)).toMatchObject({ phase: 'rebooting' });
  });

  it('refuses gVisor tarballs that do not match the pinned SHA-512', async () => {
    const updates = join(dir, 'updates');
    const actions = new UpdateActions(updates);
    const manifest = manifestOf();

    delete (manifest.components as Record<string, unknown>)['drbd'];
    await new OsUpdateManager(
      updates,
      join(dir, 'apt'),
      fakeCommands(() => '') as never,
      actions,
      jest.fn(async () => new Response('not gvisor')),
    ).run(host, manifest, 'https://cp', '/api/x', { id: 'debian', versionId: '13', arch: 'amd64' });
    expect(await actions.get(host.id)).toMatchObject({
      phase: 'failed',
      error: expect.stringContaining('does not match the signed manifest'),
    });
  });

  it("downloads the release's DRBD compat patches for its architecture and builds with them, reporting the reason on failure", async () => {
    const updates = join(dir, 'updates');
    const sha = (data: string) => createHash('sha256').update(data).digest('hex');
    const blobs: Record<string, string> = {
      [sha('drbd source')]: 'drbd source',
      [sha('compat amd64')]: 'compat amd64',
      [sha('compat arm64')]: 'compat arm64',
    };
    const fetchImpl = jest.fn(async (url: string) => new Response(blobs[url.split('/').pop() as string] ?? 'missing'));
    const commands = fakeCommands((cmd) => {
      if (cmd === 'systemd-run') {
        writeFileSync(
          join(updates, `host-${host.id}.result`),
          'failed: DRBD 9.2.20: the release ships neither a prebuilt module nor a compat patch for kernel 6.12.120+deb13-cloud-amd64 (the upgrade would install it; DRBD builds offline); nothing was changed\n',
        );

        return new CommandError('systemd-run', [], 1, 'unit failed');
      }

      return '';
    });
    const actions = new UpdateActions(updates);
    const manifest = manifestOf();
    const file = (path: string, data: string) => ({ path, sha256: sha(data), size: data.length });

    delete (manifest.components as Record<string, unknown>)['gvisor'];
    manifest.components['drbd'] = {
      kind: 'kernel-module',
      version: '9.2.20',
      source: {
        url: 'https://pkg.linbit.com/drbd.tar.gz',
        sha256: sha('drbd source'),
        file: 'artifacts/drbd/src.tar.gz',
      },
      prebuilt: [],
      compat: [
        {
          kernel: '6.12.113+deb13-cloud-amd64',
          arch: 'amd64',
          file: 'artifacts/drbd/compat/a.tar.gz',
          md5: 'a'.repeat(32),
        },
        {
          kernel: '6.12.113+deb13-cloud-arm64',
          arch: 'arm64',
          file: 'artifacts/drbd/compat/b.tar.gz',
          md5: 'b'.repeat(32),
        },
      ],
    } as ReleaseManifest['components'][string];
    manifest.artifacts.push(
      file('artifacts/drbd/src.tar.gz', 'drbd source'),
      file('artifacts/drbd/compat/a.tar.gz', 'compat amd64'),
      file('artifacts/drbd/compat/b.tar.gz', 'compat arm64'),
    );

    await new OsUpdateManager(updates, join(dir, 'apt'), commands as never, actions, fetchImpl).run(
      host,
      manifest,
      'https://cp',
      '/api/updates/artifacts',
      { id: 'debian', versionId: '13', arch: 'amd64' },
    );

    // Everything from the cluster by checksum (no upstream URL, no SPAAS); only the node's architecture.
    expect(fetchImpl.mock.calls.map(([url]) => url).sort()).toEqual(
      [sha('drbd source'), sha('compat amd64')].map((h) => `https://cp/api/updates/artifacts/${h}`).sort(),
    );

    const compatFile = join(updates, 'files', `drbd-9.2.20-compat-6.12.113+deb13-cloud-amd64-${'a'.repeat(32)}.tar.gz`);
    const script = readFileSync(join(updates, `host-${host.id}.sh`), 'utf8');

    expect(readFileSync(compatFile, 'utf8')).toBe('compat amd64');
    expect(script).toContain(`'6.12.113+deb13-cloud-amd64') compat=('${compatFile}'); md5s='${'a'.repeat(32)}' ;;`);
    expect(script).not.toContain('arm64');
    expect(script).toContain('SPAAS=false');
    // The step carries no `spaas` (air-gapped cluster): offline only, no SPAAS check.
    expect(script).not.toContain('spaas.drbd.io');
    // The script's reason is the action's error.
    expect(await actions.get(host.id)).toMatchObject({
      phase: 'failed',
      error: expect.stringContaining(
        'host update failed: DRBD 9.2.20: the release ships neither a prebuilt module nor a compat patch for kernel 6.12.120',
      ),
    });
  });

  it('lets DRBD use SPAAS only when the control plane marks the step online', async () => {
    const updates = join(dir, 'updates');
    const sha = (data: string) => createHash('sha256').update(data).digest('hex');
    const fetchImpl = jest.fn(async () => new Response('drbd source'));
    const commands = fakeCommands(() => '');
    const manifest = manifestOf();

    delete (manifest.components as Record<string, unknown>)['gvisor'];
    manifest.components['drbd'] = {
      kind: 'kernel-module',
      version: '9.2.20',
      source: { url: 'https://pkg.linbit.com/drbd.tar.gz', sha256: sha('drbd source') },
      prebuilt: [],
    } as ReleaseManifest['components'][string];

    const scriptOf = async (step: Parameters<OsUpdateManager['run']>[0]) => {
      await new OsUpdateManager(
        updates,
        join(dir, 'apt'),
        commands as never,
        new UpdateActions(updates),
        fetchImpl,
      ).run(step, manifest, 'https://cp', '/api/updates/artifacts', { id: 'debian', versionId: '13', arch: 'amd64' });

      return readFileSync(join(updates, `host-${step.id}.sh`), 'utf8');
    };

    const online = await scriptOf({ ...host, id: randomUUID(), spaas: true });

    expect(online).toContain('SPAAS=true');
    expect(online).toContain('https://spaas.drbd.io/api/v1/hello');

    const offline = await scriptOf({ ...host, id: randomUUID() });

    expect(offline).toContain('SPAAS=false');
    expect(offline).not.toContain('spaas.drbd.io');
  });

  it('reports a failed script with its line', async () => {
    const updates = join(dir, 'updates');
    const commands = fakeCommands((cmd) => {
      if (cmd === 'systemd-run') {
        writeFileSync(join(updates, `host-${host.id}.result`), 'failed line 12\n');

        return new CommandError('systemd-run', [], 1, 'unit failed');
      }

      return '';
    });
    const actions = new UpdateActions(updates);
    const manifest = manifestOf();

    delete (manifest.components as Record<string, unknown>)['drbd'];
    delete (manifest.components as Record<string, unknown>)['gvisor'];
    await new OsUpdateManager(updates, join(dir, 'apt'), commands as never, actions, drbdFetch).run(
      host,
      manifest,
      'https://cp',
      '/api/x',
      {
        id: 'debian',
        versionId: '13',
        arch: 'amd64',
      },
    );
    expect(await actions.get(host.id)).toMatchObject({ phase: 'failed', error: 'host update failed line 12' });
  });
});

describe('UpdatesService (3.26)', () => {
  let dir: string;
  const previous = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lw-updates-'));
    process.env['LOADWEAVER_RELEASE_DEV_KEYS'] = KEY.publicKeyPem;
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env = { ...previous };
    setReleaseImages(null);
    jest.restoreAllMocks();
  });

  const service = () =>
    new UpdatesService(
      { dir, identity: async () => ({ controlPlaneUrl: 'https://cp' }) } as never,
      fakeCommands() as never,
      { os: async () => ({ id: 'debian', versionId: '13', kernel: '6.12', arch: 'amd64' }) } as never,
      {
        listContainers: async () => [
          { Names: ['/lw-ingress'], Image: 'img@sha256:1', Labels: { 'loadweaver.com/component': 'ingress' } },
        ],
      } as never,
    );
  const role = { role: 'none' as const, members: [], automaticFailover: false, scope: 'c' };

  it('runs a verified release and refuses manifests signed with another key', async () => {
    const s = service();

    expect(await s.apply(components(manifestOf()), role, '10.93.0.1')).toBe(true);
    expect(componentImage('envoy', {})).toContain('v1.41.0');
    expect(await s.apply(components(manifestOf()), role, '10.93.0.1')).toBe(false);

    await expect(
      s.apply(components(manifestOf('3.5.1'), {}, generateReleaseKeyPair().privateKeyPem), role, '10.93.0.1'),
    ).rejects.toThrow(/release 3.5.1 refused/);
    await expect(s.apply({ ...components(manifestOf('3.5.1')), release: '3.9.9' }, role, '10.93.0.1')).rejects.toThrow(
      /names 3.9.9/,
    );
    // The node keeps the release it had.
    expect(componentImage('envoy', {})).toContain('v1.41.0');
    expect(await s.apply(undefined, role, '10.93.0.1')).toBe(false);
  });

  it('switches Patroni over on the leader before its member updates, and stops when that fails', async () => {
    const s = service();
    const member = { ...role, role: 'member' as const };
    let leader = true;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith('/patroni')) return new Response(JSON.stringify({ role: leader ? 'primary' : 'replica' }));

        if (url.endsWith('/cluster'))
          return new Response(
            JSON.stringify({
              members: [
                { name: 'm1', host: '10.93.0.1', role: 'leader' },
                { name: 'm2', host: '10.93.0.2', role: 'replica' },
              ],
            }),
          );

        if (url.endsWith('/switchover') && init?.method === 'POST') {
          expect(JSON.parse(String(init.body))).toEqual({ leader: 'm1', candidate: 'm2' });
          leader = false;

          return new Response('ok');
        }

        return new Response('', { status: 404 });
      });
    const id = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

    await s.apply(
      components(manifestOf(), { actions: { patroniSwitchover: { id, candidate: '10.93.0.2' } } }),
      member,
      '10.93.0.1',
    );
    expect(await s.actions.get(id)).toMatchObject({ kind: 'switchover', phase: 'done' });
    expect(fetchMock).toHaveBeenCalled();

    fetchMock.mockImplementation(async (input: string | URL | Request) =>
      String(input).endsWith('/patroni')
        ? new Response(JSON.stringify({ role: 'primary' }))
        : new Response(JSON.stringify({ members: [] })),
    );

    const other = '7f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
    const before = componentImage('postgres', {});
    const next = buildManifest({
      version: '3.6.0',
      channel: 'stable',
      created: '2026-10-19T00:00:00.000Z',
      images: {
        'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.6.0@sha256:${'d'.repeat(64)}`,
        postgres: `ghcr.io/zalando/spilo-17:4.0-p3@sha256:${'a'.repeat(64)}`,
        envoy: `docker.io/envoyproxy/envoy:v1.42.0@sha256:${'f'.repeat(64)}`,
      },
      agentBinaries: {},
    });

    await s.confirmApplied('3.5.0');
    // A failed switchover no longer blocks the member's reconcile: only Spilo keeps its image (M6 review L2).
    await expect(
      s.apply(
        components(next, { actions: { patroniSwitchover: { id: other, candidate: '10.93.0.9' } } }),
        member,
        '10.93.0.1',
      ),
    ).resolves.toBe(true);
    expect(await s.actions.get(other)).toMatchObject({
      kind: 'switchover',
      phase: 'failed',
      error: expect.stringContaining('switchover candidate 10.93.0.9 is not a Patroni member'),
    });
    expect(componentImage('postgres', {})).toBe(before);
    expect(componentImage('envoy', {})).toContain('v1.42.0');
    // Held back: the node doesn't claim the new release.
    await s.confirmApplied('3.6.0');
    expect((await s.report()).release).toBe('3.5.0');

    // Once no switchover is ordered any more (the step rolled back / moved on), the hold ends.
    await s.apply(components(next), member, '10.93.0.1');
    expect(componentImage('postgres', {})).toContain('spilo-17:4.0-p3');
    await s.confirmApplied('3.6.0');
    expect((await s.report()).release).toBe('3.6.0');
  });

  it('never switches over (nor reports done) on a member whose Patroni role is unknown', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async (url: string) => {
      calls++;

      return url.endsWith('/patroni') ? new Response('', { status: 500 }) : new Response('{}');
    });

    await expect(patroniSwitchover('10.93.0.1', '10.93.0.2', fetchImpl as never, 1_000, 1)).rejects.toThrow(
      /role of this member is unknown/,
    );
    expect(calls).toBe(3);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/switchover'))).toBe(false);

    // A replica has nothing to hand over.
    await expect(
      patroniSwitchover(
        '10.93.0.1',
        '10.93.0.2',
        (async () => new Response(JSON.stringify({ role: 'replica' }))) as never,
        1_000,
        1,
      ),
    ).resolves.toBeUndefined();
  });

  it('reports the release only once an apply completed, with etcd health and replica lag', async () => {
    const s = service();
    const member = { ...role, role: 'member' as const };

    jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith('/patroni')) return new Response(JSON.stringify({ role: 'replica' }));

      if (url.endsWith('/cluster'))
        return new Response(
          JSON.stringify({ members: [{ name: 'm1', host: '10.93.0.1', role: 'replica', lag: 2048 }] }),
        );

      if (url.endsWith('/health')) return new Response(JSON.stringify({ health: 'true' }));

      if (url.endsWith('/v3/cluster/member/list'))
        return new Response(JSON.stringify({ members: [{ ID: '1' }, { ID: '2' }, { ID: '3' }] }));

      return new Response('', { status: 404 });
    });

    await s.apply(components(manifestOf()), member, '10.93.0.1');
    // Applied in memory, containers not replaced yet: no release.
    expect((await s.report()).release).toBeUndefined();

    await s.confirmApplied('3.5.0');

    const report = await s.report();

    expect(report).toMatchObject({
      release: '3.5.0',
      postgres: 'replica',
      postgresLag: 2048,
      etcd: { healthy: true, members: 3 },
    });
    // Persisted: a restarted agent reports what it applied last.
    expect((await service().report()).release).toBe('3.5.0');
  });

  it('reports images by release component, actions and the release', async () => {
    const s = service();

    await s.apply(components(manifestOf()), role, '10.93.0.1');
    await s.confirmApplied('3.5.0');

    const report = await s.report();

    expect(report).toMatchObject({
      release: '3.5.0',
      images: { envoy: 'img@sha256:1' },
      actions: [expect.objectContaining({ id: 'images:3.5.0' })],
    });
  });

  it("reports the created-from reference (with its digest) when Docker lists a container's image ID", async () => {
    const etcd = `quay.io/coreos/etcd:v3.5.21@sha256:${'a'.repeat(64)}`;
    const inspected: string[] = [];
    const s = new UpdatesService(
      { dir, identity: async () => ({ controlPlaneUrl: 'https://cp' }) } as never,
      fakeCommands() as never,
      { os: async () => ({ id: 'debian', versionId: '13', kernel: '6.12', arch: 'amd64' }) } as never,
      {
        listContainers: async () => [
          // The reference resolves: Docker lists it as created (VM lab, containerd image store) — no inspect.
          {
            Id: 'c1',
            Names: ['/lw-ingress'],
            Image: 'img@sha256:1',
            Labels: { 'loadweaver.com/component': 'ingress' },
          },
          // The reference no longer resolves (classic store, untagged): Docker lists the image ID instead.
          {
            Id: 'c2',
            Names: ['/lw-etcd'],
            Image: `sha256:${'f'.repeat(64)}`,
            Labels: { 'loadweaver.com/component': 'etcd' },
          },
          { Id: 'c3', Names: ['/lw-queue'], Image: 'valkey:dev', Labels: { 'loadweaver.com/component': 'queue' } },
        ],
        getContainer: (id: string) => ({
          inspect: async () => {
            inspected.push(id);

            return { Config: { Image: id === 'c2' ? etcd : 'valkey:dev' } };
          },
        }),
      } as never,
    );

    expect((await s.report()).images).toEqual({ envoy: 'img@sha256:1', etcd, valkey: 'valkey:dev' });
    expect(inspected).toEqual(['c2', 'c3']);
  });

  it('maps containers and DRBD state', () => {
    expect(componentOfContainer('queue', 'lw-queue')).toBe('valkey');
    expect(componentOfContainer('ratelimit', 'lw-ratelimit-valkey')).toBe('valkey');
    expect(componentOfContainer('mesh', 'lw-mesh')).toBe('envoy');
    expect(componentOfContainer('unknown', 'x')).toBeNull();
    expect(
      replicationOf(
        JSON.stringify([
          {
            devices: [{ 'disk-state': 'UpToDate' }],
            connections: [
              {
                'connection-state': 'Connected',
                peer_devices: [{ 'replication-state': 'Established', 'peer-disk-state': 'UpToDate' }],
              },
            ],
          },
          {
            devices: [{ 'disk-state': 'Inconsistent' }],
            connections: [{ 'connection-state': 'Connected', peer_devices: [{ 'replication-state': 'SyncTarget' }] }],
          },
          {
            devices: [{ 'disk-state': 'UpToDate' }],
            connections: [{ 'connection-state': 'Connecting', peer_devices: [] }],
          },
        ]),
      ),
    ).toEqual({ volumes: 3, syncing: 1, degraded: 1 });
    expect(replicationOf('not json')).toEqual({ volumes: 0, syncing: 0, degraded: 0 });
  });
});

describe('Envoy handover (3.26)', () => {
  let dir: string;
  let servers: Server[] = [];
  const drained: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lw-envoy-'));
  });

  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers = [];
    rmSync(dir, { recursive: true, force: true });
  });

  /** A fake Envoy admin endpoint on a unix socket. */
  const admin = (image: string, ready = true) =>
    new Promise<void>((resolve) => {
      const server = createServer((req, res) => {
        if (req.url === '/ready') return res.writeHead(ready ? 200 : 503).end(ready ? 'LIVE' : 'PRE_INITIALIZING');

        if (req.url?.startsWith('/drain_listeners') && req.method === 'POST') {
          drained.push(image);

          return res.writeHead(200).end('OK');
        }

        res.writeHead(404).end();
      });

      servers.push(server);
      server.listen(join(dir, envoyAdminSocketName(image)), resolve);
    });

  function fakes(current: { image: string; running: boolean } | null) {
    const names: string[] = [];
    const removed: string[] = [];
    const containers = {
      ensure: jest.fn(async (spec: { name: string }) => {
        names.push(spec.name);

        return true;
      }),
      pull: jest.fn(async () => undefined),
      remove: jest.fn(async (name: string) => {
        removed.push(name);

        return true;
      }),
    };
    const renamed: string[] = [];
    const docker = {
      getContainer: (name: string) => ({
        inspect: async () => {
          if (!current || name !== 'lw-ingress') throw new Error('no such container');

          return {
            State: { Running: current.running },
            Config: { Image: current.image, Labels: { 'loadweaver.com/managed': 'true' } },
          };
        },
        rename: async ({ name: to }: { name: string }) => {
          renamed.push(`${name}->${to}`);
        },
      }),
      listContainers: async () => [],
    };

    return { containers, docker, renamed, removed, names };
  }

  const spec = (image: string) => ({
    name: 'lw-ingress',
    image,
    env: {},
    binds: [],
    memoryBytes: 1,
    hash: image,
    component: 'ingress',
  });

  it('starts the new image next to the old one, drains the old one, removes it after the drain time', async () => {
    const f = fakes({ image: 'envoy:old', running: true });

    await admin('envoy:old');
    await admin('envoy:new');
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

    const done = new EnvoyHandover(f.containers as never, f.docker as never).ensure(
      spec('envoy:new') as never,
      dir,
      30,
    );

    jest.useRealTimers();
    expect(await done).toBe(true);
    expect(f.renamed).toEqual([expect.stringMatching(/^lw-ingress->lw-ingress-draining-\d+$/)]);
    expect(f.containers.ensure).toHaveBeenCalledWith(expect.objectContaining({ image: 'envoy:new' }));
    expect(drained).toEqual(['envoy:old']);
  });

  it('keeps the old Envoy when the new one never gets ready', async () => {
    const f = fakes({ image: 'envoy:old', running: true });

    await admin('envoy:new', false);

    const handover = new EnvoyHandover(f.containers as never, f.docker as never);
    const waitReady = jest.spyOn(Date, 'now');
    let t = 0;

    waitReady.mockImplementation(() => (t += 30_000));
    await expect(handover.ensure(spec('envoy:new') as never, dir, 30)).rejects.toThrow(/did not become ready/);
    waitReady.mockRestore();
    expect(f.removed).toContain('lw-ingress');
    expect(f.renamed[1]).toMatch(/^lw-ingress-draining-\d+->lw-ingress$/);
  });

  it('creates normally when nothing runs or only the configuration changes', async () => {
    const none = fakes(null);

    await new EnvoyHandover(none.containers as never, none.docker as never).ensure(spec('envoy:new') as never, dir, 30);
    expect(none.renamed).toEqual([]);

    const same = fakes({ image: 'envoy:new', running: true });

    await new EnvoyHandover(same.containers as never, same.docker as never).ensure(spec('envoy:new') as never, dir, 30);
    expect(same.renamed).toEqual([]);
    expect(same.containers.ensure).toHaveBeenCalled();
  });
});
