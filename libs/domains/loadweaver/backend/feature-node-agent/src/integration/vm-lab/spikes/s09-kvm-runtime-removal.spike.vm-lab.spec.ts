import { join } from 'node:path';

import { BUSYBOX } from '../m7/m7-lab';
import { WORKSPACE } from '../vm-lab.global-setup';

import { type SpikeLab, spikeRecorder, startSpikeLab } from './spike-lab';

/**
 * Spike S9 — KVM runtime removal: does the shared host script's `install` with `GVISOR_KVM=0` remove previously
 * registered KVM runtimes, and does it need the network for that (re-running the gVisor install)? Compared with the
 * dedicated `uninstall-kvm` / `install-kvm` commands W4 added (no download). Egress is blocked during the runs, so a
 * download attempt shows up as a failure.
 */
const rec = spikeRecorder({
  id: 'S9',
  title: 'KVM runtime removal without a reinstall',
  validates:
    'M7.1 per-node KVM opt-out: `desiredState.host.kvm: disabled` runs `uninstall-kvm` (W4) instead of `GVISOR_KVM=0 install`',
  ifFails:
    'if uninstall-kvm / install-kvm need the network or leave runtimes behind: fix the host script (daemon.json edit + reload only) before shipping the opt-out',
});

const HOST_SCRIPT = join(WORKSPACE, 'apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh');
const COMPONENTS = join(__dirname, '..', 'components.generated.sh');

describe('spike S9: KVM runtime removal', () => {
  let s: SpikeLab;

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [{ name: 'vm1', site: 'a', memoryMb: 2048, cpus: 2, nested: true }],
      driver: false,
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await s?.lab.stop();
  }, 300_000);

  it('compares GVISOR_KVM=0 install with uninstall-kvm / install-kvm, offline', async () => {
    if (!s.nested) return;

    const [vm] = s.vms;
    const kvmRuntimes = async () =>
      (await vm.exec(`docker info --format '{{json .Runtimes}}' | jq -r 'keys[]' | grep '^runsc-kvm' || true`))
        .trim()
        .split('\n')
        .filter(Boolean);
    const offline = (on: boolean) =>
      vm.exec(
        on
          ? "nft add table inet lwspike; nft 'add chain inet lwspike out { type filter hook output priority 0; }'; nft add rule inet lwspike out ip daddr != { 10.0.0.0/8, 127.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 } drop"
          : 'nft delete table inet lwspike 2>/dev/null || true',
      );

    await vm.copyIn(COMPONENTS, '/root/components.sh', '0700');
    await vm.copyIn(HOST_SCRIPT, '/usr/local/sbin/agenstra-gvisor.sh', '0755');
    await rec.time('components (KVM prep + runtimes)', () =>
      vm.exec('bash /root/components.sh > /var/log/lw-components.log 2>&1', { timeoutMs: 1_800_000 }),
    );
    expect(
      rec.verdict(
        'KVM runtimes registered by the installer',
        (await kvmRuntimes()).length >= 1,
        (await kvmRuntimes()).join(','),
      ),
    ).toBe(true);

    await offline(true);

    try {
      const legacy = await vm.execResult(
        'GVISOR_KVM=0 AGENSTRA_KVM=0 /usr/local/sbin/agenstra-gvisor.sh install 2>&1 | tail -n 20',
        { allowFailure: true, timeoutMs: 600_000 },
      );
      const left = await kvmRuntimes();

      rec.note('GVISOR_KVM=0 install (offline)', legacy.stdout.trim().split('\n').slice(-5).join(' | '));
      rec.verdict(
        'GVISOR_KVM=0 install removes the KVM runtimes offline (informational)',
        left.length === 0,
        `left: ${left.join(',') || 'none'}`,
      );

      // Back to KVM (offline: install-kvm never downloads).
      const restore = await vm.execResult('/usr/local/sbin/agenstra-gvisor.sh install-kvm 2>&1 | tail -n 5', {
        allowFailure: true,
        timeoutMs: 600_000,
      });

      expect(
        rec.verdict(
          'install-kvm registers the KVM runtimes offline',
          (await kvmRuntimes()).length >= 1,
          restore.stdout.trim(),
        ),
      ).toBe(true);

      const t0 = Date.now();
      const uninstall = await vm.execResult('/usr/local/sbin/agenstra-gvisor.sh uninstall-kvm 2>&1 | tail -n 5', {
        allowFailure: true,
        timeoutMs: 600_000,
      });

      rec.measure('uninstall-kvm', Math.round((Date.now() - t0) / 100) / 10, 's');
      expect(
        rec.verdict(
          'uninstall-kvm removes only the KVM runtimes, offline',
          (await kvmRuntimes()).length === 0,
          uninstall.stdout.trim(),
        ),
      ).toBe(true);
      expect(
        rec.verdict(
          'the systrap runtimes stay',
          (await vm.exec(`docker info --format '{{json .Runtimes}}' | jq -r 'keys[]'`)).includes('runsc-systrap'),
        ),
      ).toBe(true);
      // Workloads keep running (reload, not restart).
      expect(
        rec.verdict(
          'a running container survives the runtime edits',
          (
            await vm.exec(
              `docker run -d --rm ${BUSYBOX} sleep 60 >/dev/null && systemctl reload docker && sleep 2 && docker ps -q | wc -l`,
            )
          ).trim() !== '0',
        ),
      ).toBe(true);
    } finally {
      await offline(false);
    }
  });
});
