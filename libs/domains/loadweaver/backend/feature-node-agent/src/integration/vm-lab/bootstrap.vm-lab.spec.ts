import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import { DR_AGENT_BUNDLE } from './vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from './vm-lab';

/**
 * First-node bootstrap, phase by phase (M6 gate: the DR drill's bootstrap took 241–327 s after Patroni moved to the
 * member's local etcd vs 130–151 s before). The real agent (`dr-agent.entry.ts`, as in the drill) bootstraps the
 * control plane on one VM sized like the drill's vm1, twice: (1) cold — etcd / Spilo / Valkey pulled during the
 * bootstrap, as in the drill; (2) warm — the VM wiped, the images pulled beforehand. Each run records a timeline from
 * the agent's output, Docker's events and the etcd / Patroni / API logs (timestamps on the guest's clock), printed at
 * the end; the test only asserts that the bootstrap succeeds.
 */

const AGENT = '/opt/loadweaver/dr-agent.js';
const CP_IMAGE = 'loadweaver-control-plane-api:dr-lab';
const ENV = ['LOADWEAVER_STATE_DIR=/var/lib/loadweaver', `LOADWEAVER_CONTROL_PLANE_IMAGE=${CP_IMAGE}`];
const PLATFORM_IMAGES = [COMPONENT_IMAGES.etcd, COMPONENT_IMAGES.postgres, COMPONENT_IMAGES.valkey];

/** Log lines that mark a phase (container log → pattern). */
const MARKERS: Record<string, RegExp[]> = {
  'lw-etcd': [/ready to serve client requests/, /became leader/],
  'lw-postgres': [
    /waiting for|failed to connect|Failed to get list of machines|DCS|etcd/i,
    /initialized a new cluster|bootstrap.*in progress|running initdb/i,
    /acquired session lock as a leader|no action\. I am \(.*\), the leader/,
  ],
  'lw-control-plane': [/Nest application successfully started|Application is running|listening/i, /migration/i],
};

describe('first-node bootstrap phases (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  // Created by beforeAll (a describe filtered out with -t never runs afterAll, which removes it).
  let local = '';
  const results: Record<string, unknown> = {};

  const prepare = async () => {
    const start = Date.now();

    await vm1.copyIn(DR_AGENT_BUNDLE, AGENT);
    await vm1.exec('install -d -m 0700 /var/lib/loadweaver && sysctl -qw net.ipv4.ip_forward=1');
    await vm1.copyIn(join(local, 'cp.tar'), '/var/tmp/cp.tar');
    await vm1.exec('docker load -q -i /var/tmp/cp.tar && rm -f /var/tmp/cp.tar', { timeoutMs: 600_000 });

    return Math.round((Date.now() - start) / 100) / 10;
  };

  /** Runs the bootstrap and returns its timeline (seconds since the command started). */
  const bootstrap = async (label: string) => {
    const t0 = Number((await vm1.exec('date +%s.%N')).trim());
    const out = await vm1.execResult(
      `${ENV.map((e) => `export ${e}`).join('; ')}; node ${AGENT} bootstrap --name n1 --public-host ${vm1.ip} 2>&1 | while IFS= read -r line; do printf '%s %s\\n' "$(date +%s.%N)" "$line"; done; exit "\${PIPESTATUS[0]}"`,
      { timeoutMs: 1_200_000, allowFailure: true },
    );
    const t1 = Number((await vm1.exec('date +%s.%N')).trim());
    const rel = (t: number) => Math.round((t - t0) * 10) / 10;
    const timeline: string[] = [];

    for (const line of out.stdout.split('\n')) {
      const m = /^(\d+\.\d+) (.*)$/.exec(line);

      if (m && /etcd|postgres|Postgres|Spilo|control plane|Joined|health|pull|image|container|Creat|Start/i.test(m[2]))
        timeline.push(
          `${rel(Number(m[1]))}s agent: ${m[2].replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '').slice(0, 200)}`,
        );
    }

    const events = await vm1.exec(
      `docker events --since ${Math.floor(t0)} --until ${Math.ceil(t1)} --format '{{.TimeNano}} {{.Type}} {{.Action}} {{if .Actor.Attributes.name}}{{.Actor.Attributes.name}}{{else}}{{.Actor.ID}}{{end}}' | grep -E ' (image pull|container (create|start|die|destroy|health_status))'`,
      { timeoutMs: 60_000, allowFailure: true },
    );

    for (const line of events.split('\n').filter(Boolean)) {
      const [nanos, ...rest] = line.split(' ');

      timeline.push(`${rel(Number(nanos) / 1e9)}s docker: ${rest.join(' ').slice(0, 200)}`);
    }

    for (const [container, patterns] of Object.entries(MARKERS)) {
      const logs = await vm1.execResult(`docker logs -t ${container} 2>&1 | head -n 4000`, {
        timeoutMs: 60_000,
        allowFailure: true,
      });
      const seen = new Set<number>();
      let first = true;

      for (const line of logs.stdout.split('\n')) {
        const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/.exec(line);

        if (!m) continue;

        const t = Date.parse(m[1]) / 1000;

        if (first) {
          timeline.push(`${rel(t)}s ${container}: first log line`);
          first = false;
        }

        patterns.forEach((p, i) => {
          // First match of each marker, plus every DCS complaint of Patroni (they show waits on etcd).
          if (p.test(m[2]) && (!seen.has(i) || (container === 'lw-postgres' && i === 0 && seen.size < 40))) {
            seen.add(i);
            timeline.push(`${rel(t)}s ${container}: ${m[2].slice(0, 200)}`);
          }
        });
      }
    }

    timeline.sort((a, b) => parseFloat(a) - parseFloat(b));
    results[label] = { seconds: rel(t1), exit: out.code, timeline };
    process.stderr.write(`[bootstrap] ${label}: ${rel(t1)} s (exit ${out.code})\n${timeline.join('\n')}\n`);

    if (out.code !== 0) throw new Error(`${label} failed:\n${out.stdout.slice(-3000)}`);

    return rel(t1);
  };

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), 'lw-vmlab-bootstrap-'));
    // The control-plane image of this tree, as in the DR drill (see dr.vm-lab.spec.ts).
    execFileSync('docker', ['image', 'inspect', CP_IMAGE], { stdio: 'ignore' });
    execFileSync('docker', ['save', '-o', join(local, 'cp.tar'), CP_IMAGE]);
    results['cpImageMb'] = Math.round(statSync(join(local, 'cp.tar')).size / 1024 ** 2);
    lab = await startVmLab({
      vms: [{ name: 'vm1', site: 'a', memoryMb: 3072, cpus: 3 }],
      log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
    });
    ({ vm1 } = lab.vms as Record<'vm1', Vm>);
  }, 1_800_000);

  afterAll(async () => {
    process.stderr.write(`[bootstrap] results ${JSON.stringify(results)}\n`);
    await lab?.stop();
    if (local) rmSync(local, { recursive: true, force: true });
  }, 300_000);

  it('bootstraps with the platform images pulled during the bootstrap (as in the DR drill)', async () => {
    results['prepareColdS'] = await prepare();
    expect(await bootstrap('cold')).toBeGreaterThan(0);
  });

  it('bootstraps with the platform images already on the node', async () => {
    await vm1.wipe();
    results['prepareWarmS'] = await prepare();

    const start = Date.now();

    for (const image of PLATFORM_IMAGES) await vm1.exec(`docker pull -q ${image} >/dev/null`, { timeoutMs: 900_000 });

    results['pullS'] = Math.round((Date.now() - start) / 100) / 10;
    expect(await bootstrap('warm')).toBeGreaterThan(0);
  });
});
