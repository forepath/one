import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LabRecorder } from '@forepath/shared/backend/util-vm-lab';
import type { ComponentVersions, NodeComponents } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  buildManifest,
  canonicalJson,
  generateReleaseKeyPair,
  REQUIRED_HOST_PACKAGES,
  signManifest,
  type ArtifactFile,
  type ReleaseManifest,
} from '@forepath/loadweaver/shared/util-release';

import { APT_SOURCE_BUNDLE, UPDATES_AGENT_BUNDLE } from '../vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import { eventually, log } from './m7-lab';

/**
 * Required host packages on an older node (M7 F2): a node installed before microVMs needed `attr` / `e2fsprogs`
 * (here: `attr` purged) gets them with its next host step, from the release's frozen apt snapshot only — never
 * upstream — also without an OS upgrade, and nothing it already has is touched. vm1 serves the cluster's snapshot and
 * artifact routes (the M6 apt-source stand-in), vm2 runs the agent's real `UpdatesService` under systemd (the M6
 * update driver); the test plays the rollout controller. No nested KVM needed.
 */

const KEY = generateReleaseKeyPair();
const CP_PORT = 8080;
const SOCKET = '/run/lw-updates-lab.sock';
const ROLE = { role: 'none' as const, members: [], automaticFailover: false, scope: 'lab' };
const UPSTREAMS = [
  {
    name: 'debian-trixie',
    url: 'https://deb.debian.org/debian',
    suites: ['trixie', 'trixie-updates'],
    components: ['main'],
    arches: ['amd64'],
    keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
    os: 'debian:13',
  },
  {
    name: 'debian-security-trixie',
    url: 'https://security.debian.org/debian-security',
    suites: ['trixie-security'],
    components: ['main'],
    arches: ['amd64'],
    keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
    os: 'debian:13',
  },
];

function wrapper(version: string): string {
  return [
    '#!/bin/sh',
    `export LOADWEAVER_AGENT_VERSION=${version}`,
    'export LOADWEAVER_STATE_DIR=/var/lib/loadweaver',
    'export LOADWEAVER_SELF_UPDATE_CONFIRM_SECONDS=30',
    'export LOADWEAVER_RELEASE_DEV_KEYS="$(cat /etc/loadweaver/release-dev.pem)"',
    'exec /usr/local/bin/node /opt/loadweaver/updates-agent.js serve',
    '',
  ].join('\n');
}

describe('required host packages on an older node (VM lab, M7 F2)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let local = '';
  const rec = new LabRecorder('m7-host-packages');

  const agent = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const data = body === undefined ? '' : `-H 'content-type: application/json' --data-binary @/tmp/lw-req.json`;

    if (body !== undefined) {
      writeFileSync(join(local, 'req.json'), JSON.stringify(body));
      await vm2.copyIn(join(local, 'req.json'), '/tmp/lw-req.json', '0600');
    }

    return JSON.parse(
      await vm2.exec(`curl -sf --max-time 600 --unix-socket ${SOCKET} -X ${method} ${data} http://lab${path}`, {
        timeoutMs: 660_000,
      }),
    ) as T;
  };
  const publish = async (name: string, content: string, path: string): Promise<ArtifactFile> => {
    writeFileSync(join(local, name), content);
    await vm1.copyIn(join(local, name), `/tmp/${name}`, '0644');

    const sha = (await vm1.exec(`node /opt/loadweaver/apt-source.js put /srv/lw /tmp/${name}`)).trim();

    expect(sha).toBe(createHash('sha256').update(content).digest('hex'));

    return { path, sha256: sha, size: Buffer.byteLength(content) };
  };
  const components = (manifest: ReleaseManifest, extra: Partial<NodeComponents> = {}): NodeComponents => {
    const bytes = canonicalJson(manifest);

    return {
      release: manifest.version,
      manifest: bytes,
      signature: JSON.stringify(signManifest(Buffer.from(bytes), KEY.privateKeyPem)),
      artifactBase: '/api/updates/artifacts',
      ...extra,
    };
  };
  const installed = async (pkg: string) =>
    (await vm2.exec(`dpkg-query -W -f='\${db:Status-Status} \${Version}' ${pkg} 2>/dev/null || true`)).trim();

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), 'lw-vmlab-hostpkgs-'));
    lab = await rec.time('lab up', () =>
      startVmLab({
        vms: [
          { name: 'vm1', site: 'a', memoryMb: 1024, nested: false },
          { name: 'vm2', site: 'a', memoryMb: 1536, cpus: 2, nested: false },
        ],
        log,
      }),
    );
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    await vm1.exec('mkdir -p /opt/loadweaver /srv/lw');
    await vm1.copyIn(APT_SOURCE_BUNDLE, '/opt/loadweaver/apt-source.js', '0644');
    writeFileSync(join(local, 'release-dev.pem'), KEY.publicKeyPem);
    writeFileSync(join(local, 'agent'), wrapper('3.4.0'));
    writeFileSync(
      join(local, 'identity.json'),
      JSON.stringify({
        clusterId: 'lab',
        nodeName: 'n2',
        controlPlaneUrl: `http://${vm1.ip}:${CP_PORT}`,
        controlPlaneEndpoints: [],
      }),
    );
    writeFileSync(
      join(local, 'loadweaver-agent.service'),
      [
        '[Unit]',
        'Description=Loadweaver node agent (VM lab)',
        '[Service]',
        'ExecStart=/usr/local/bin/loadweaver-agent',
        'Restart=always',
        '[Install]',
        'WantedBy=multi-user.target',
        '',
      ].join('\n'),
    );
    await vm2.exec('mkdir -p /opt/loadweaver /etc/loadweaver /var/lib/loadweaver && chmod 700 /var/lib/loadweaver');
    await vm2.copyIn(UPDATES_AGENT_BUNDLE, '/opt/loadweaver/updates-agent.js', '0644');
    await vm2.copyIn(join(local, 'release-dev.pem'), '/etc/loadweaver/release-dev.pem', '0644');
    await vm2.copyIn(join(local, 'agent'), '/usr/local/bin/loadweaver-agent', '0755');
    await vm2.copyIn(join(local, 'identity.json'), '/var/lib/loadweaver/identity.json', '0600');
    await vm2.copyIn(join(local, 'loadweaver-agent.service'), '/etc/systemd/system/loadweaver-agent.service', '0644');
    await vm2.exec('systemctl daemon-reload && systemctl enable --now loadweaver-agent');
    await eventually(
      'agent up',
      async () => ((await agent<{ version: string }>('GET', '/version')).version === '3.4.0' ? true : undefined),
      60_000,
    );
  }, 1_800_000);

  afterAll(async () => {
    rec.flush();
    await lab?.stop();

    if (local) rmSync(local, { recursive: true, force: true });
  }, 300_000);

  it('installs the missing required packages from the snapshot on a host step without an OS upgrade', async () => {
    expect(REQUIRED_HOST_PACKAGES).toEqual(expect.arrayContaining(['attr', 'e2fsprogs']));

    // An "older node": no attr (as before F2's installer change); e2fsprogs stays (already there: untouched).
    await vm2.exec(
      'DEBIAN_FRONTEND=noninteractive apt-get purge -y -q attr >/dev/null 2>&1 || dpkg --purge --force-depends attr',
    );
    expect(await installed('attr')).not.toMatch(/^installed/);

    const e2fsBefore = await installed('e2fsprogs');

    writeFileSync(join(local, 'upstreams.json'), JSON.stringify(UPSTREAMS));
    await vm1.copyIn(join(local, 'upstreams.json'), '/tmp/upstreams.json', '0644');

    const snapshot = (
      await rec.time('apt snapshot', () =>
        vm1.exec('node /opt/loadweaver/apt-source.js snapshot /srv/lw /tmp/upstreams.json', { timeoutMs: 600_000 }),
      )
    ).trim();

    await vm1.exec(
      `systemd-run --unit=lw-cluster --collect node /opt/loadweaver/apt-source.js serve /srv/lw ${CP_PORT}`,
    );

    // No upstream on the node: only the cluster's snapshot can deliver the package.
    await vm2.exec(
      'mv /etc/apt/sources.list.d /etc/apt/sources.list.d.lab-off 2>/dev/null || true; : > /etc/apt/sources.list; rm -rf /var/lib/apt/lists/*',
    );

    const manifest = buildManifest({
      version: '3.5.0',
      channel: 'stable',
      created: new Date().toISOString(),
      images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:${'c'.repeat(64)}` },
      agentBinaries: {
        amd64: await publish('agent-3.5.0', wrapper('3.5.0'), 'artifacts/bin/loadweaver-agent-linux-amd64'),
      },
    });
    const sources = UPSTREAMS.map((u) => ({
      name: u.name,
      suites: u.suites,
      components: u.components,
      keyring: u.keyring,
    }));
    const host = { id: randomUUID(), snapshot, aptBase: `/api/updates/apt/${snapshot}`, sources, upgrade: false };
    const target = components(manifest, { host });

    await agent('POST', '/apply', { components: target, role: ROLE, address: vm2.ip });
    await agent('POST', '/after-apply', { components: target });

    const done = await rec.time('host step', () =>
      eventually(
        'host step done',
        async () => {
          const action = (await agent<ComponentVersions>('GET', '/report')).actions?.find((a) => a.id === host.id);

          if (action?.phase === 'failed') throw new Error(`host step failed: ${action.error}`);

          return action?.phase === 'done' ? action : undefined;
        },
        20 * 60_000,
        5_000,
      ),
    );

    rec.note('host step', done);
    expect(await installed('attr')).toMatch(/^installed /);
    expect(await installed('e2fsprogs')).toBe(e2fsBefore);
    expect(await vm1.exec("journalctl -u lw-cluster --no-pager | grep -c 'attr_' || true")).not.toMatch(/^0\s*$/);
    // No reboot of its own.
    expect(await vm2.exec('test -e /run/reboot-required && echo reboot || echo none')).toContain('none');
    expect(JSON.stringify((await agent<ComponentVersions>('GET', '/report')).packages ?? {})).toMatch(/attr/);
  });
});
