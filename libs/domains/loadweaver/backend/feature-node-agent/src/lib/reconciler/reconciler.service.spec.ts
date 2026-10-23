import { desiredState } from '../test-fixtures';
import { keptHostRoutes, ReconcilerService } from './reconciler.service';

function deps(overrides: Record<string, unknown> = {}) {
  const ok = (value = true) => ({ apply: jest.fn().mockResolvedValue(value) });

  return {
    loopback: ok(false),
    wireguard: ok(),
    bird: ok(),
    nftables: ok(),
    podNetwork: {
      apply: jest
        .fn()
        .mockResolvedValue({ changed: false, spec: { subnets: ['10.88.0.0/24'], gateways: ['10.88.0.1'] } }),
    },
    dns: { update: jest.fn(), bind: jest.fn().mockResolvedValue(undefined) },
    controlPlane: ok(false),
    workloads: ok(false),
    volumes: { ...ok(false), forgetPeerWarning: jest.fn().mockReturnValue(undefined) },
    objectStore: ok(false),
    registry: ok(false),
    registryRouter: ok(false),
    dockerForward: ok(false),
    publicAddresses: ok(false),
    ingress: ok(false),
    authoritativeDns: ok(false),
    rateLimiter: ok(false),
    egressRouting: ok(false),
    mesh: ok(false),
    vpn: ok(false),
    logs: { updateFirewall: jest.fn(), updateWorkloads: jest.fn() },
    state: { saveAppliedState: jest.fn(), appliedState: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

function reconciler(d: ReturnType<typeof deps>, updates?: unknown): ReconcilerService {
  return new ReconcilerService(
    d.loopback as never,
    d.egressRouting as never,
    d.mesh as never,
    d.wireguard as never,
    d.bird as never,
    d.nftables as never,
    d.podNetwork as never,
    d.dns as never,
    d.controlPlane as never,
    d.state as never,
    d.workloads as never,
    d.volumes as never,
    d.objectStore as never,
    d.registry as never,
    d.registryRouter as never,
    d.dockerForward as never,
    d.publicAddresses as never,
    d.ingress as never,
    d.authoritativeDns as never,
    d.rateLimiter as never,
    d.vpn as never,
    d.logs as never,
    updates as never,
  );
}

describe('ReconcilerService', () => {
  it('applies all layers in order and records the applied state', async () => {
    const d = deps();
    const report = await reconciler(d).apply(desiredState(3));

    expect(report.status).toBe('applied');
    expect(report.steps.map((s) => `${s.layer}:${s.status}`)).toEqual([
      'tunnels:applied',
      'routing:applied',
      'filtering:applied',
      'remote-access:unchanged',
      'services:unchanged',
      'mesh:unchanged',
      'public-addresses:unchanged',
      'dns:applied',
      'control-plane:unchanged',
      'object-store:unchanged',
      'registry:unchanged',
      'ingress:unchanged',
      'authoritative-dns:unchanged',
      'rate-limiter:unchanged',
      'volumes:unchanged',
      'workloads:unchanged',
    ]);
    expect(d.dns.bind).toHaveBeenCalledWith({ listen: ['10.88.0.1'], clients: ['10.88.0.0/24'], upstreams: [] });
    expect(d.controlPlane.apply).toHaveBeenCalledWith('n1', '10.93.0.1', expect.objectContaining({ role: 'none' }));
    expect(d.state.saveAppliedState).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }));
  });

  it("reports a layer's warning on its step without failing the apply (pending DRBD forget-peer)", async () => {
    const d = deps();

    d.volumes.forgetPeerWarning.mockReturnValue('DRBD forget-peer pending, retried on the next reconcile: v1');

    const report = await reconciler(d).apply(desiredState(3));

    expect(report.status).toBe('applied');
    expect(report.steps.find((s) => s.layer === 'volumes')).toEqual({
      layer: 'volumes',
      status: 'unchanged',
      message: 'DRBD forget-peer pending, retried on the next reconcile: v1',
    });
    expect(report.steps.find((s) => s.layer === 'workloads')).not.toHaveProperty('message');
  });

  it('rolls back to the last applied state when a layer fails', async () => {
    const d = deps();

    d.bird.apply.mockRejectedValueOnce(new Error('bird: syntax error'));
    d.state.appliedState.mockResolvedValue(desiredState(2));

    const report = await reconciler(d).apply(desiredState(3));

    expect(report.status).toBe('rolled-back');
    expect(report.error).toContain('bird: syntax error');
    expect(report.steps.find((s) => s.layer === 'routing')).toMatchObject({ status: 'failed' });
    expect(report.steps.some((s) => s.layer === 'filtering')).toBe(false);
    expect(d.bird.apply).toHaveBeenCalledTimes(2);
    expect(d.state.saveAppliedState).not.toHaveBeenCalled();
  });

  it('confirms the release only after every layer ran; a failed control-plane layer confirms the previous one', async () => {
    const d = deps();
    const updates = { apply: jest.fn().mockResolvedValue(true), confirmApplied: jest.fn() };
    const withRelease = (revision: number, release: string) =>
      ({
        ...desiredState(revision),
        components: { release, manifest: '{}', artifactBase: '/api/updates/artifacts' },
      }) as never;

    expect((await reconciler(d, updates).apply(withRelease(3, '3.5.0'))).status).toBe('applied');
    expect(updates.confirmApplied.mock.calls).toEqual([['3.5.0']]);

    updates.confirmApplied.mockClear();
    d.controlPlane.apply.mockRejectedValueOnce(new Error('etcd did not start'));
    d.state.appliedState.mockResolvedValue(withRelease(3, '3.5.0'));

    const report = await reconciler(d, updates).apply(withRelease(4, '3.6.0'));

    expect(report.status).toBe('rolled-back');
    expect(report.steps.find((s) => s.layer === 'control-plane')).toMatchObject({ status: 'failed' });
    expect(updates.confirmApplied.mock.calls).toEqual([['3.5.0']]);
  });

  it('reports the real state when the rollback fails too (3.19)', async () => {
    const d = deps();

    d.nftables.apply.mockRejectedValue(new Error('nft: no such table'));
    d.state.appliedState.mockResolvedValue(desiredState(2));

    const report = await reconciler(d).apply(desiredState(3));

    expect(report).toMatchObject({ status: 'failed', error: expect.stringContaining('rollback to revision 2 failed') });
  });

  it('refuses states that fail validation on the node', async () => {
    const d = deps();
    const bad = desiredState(4);

    bad.network.firewall.rules[0].srcSet = 'bad; drop';

    expect(await reconciler(d).apply(bad)).toMatchObject({
      status: 'failed',
      error: 'desired state failed validation on the node',
    });
    expect(d.wireguard.apply).not.toHaveBeenCalled();
  });

  it('serializes applies', async () => {
    const d = deps();
    const order: number[] = [];

    d.wireguard.apply.mockImplementation(async () => {
      order.push(order.length);
      await new Promise((r) => setTimeout(r, 5));

      return true;
    });

    const r = reconciler(d);

    await Promise.all([r.apply(desiredState(1)), r.apply(desiredState(2))]);
    expect(d.state.saveAppliedState.mock.calls.map((c) => c[0].revision)).toEqual([1, 2]);
  });
});

describe('keptHostRoutes (3.10, M7.4)', () => {
  it("includes the kept addresses of a VM's further NICs", () => {
    expect(
      keptHostRoutes({
        hostRoutes: ['10.88.1.10/32'],
        vm: {
          nics: [
            { name: 'eth0', addresses: ['10.88.1.10'] },
            { name: 'eth1', addresses: ['10.88.1.11', 'fd88:1::11'], hostRoutes: ['10.88.1.11/32', 'fd88:1::11/128'] },
          ],
        },
      } as never),
    ).toEqual(['10.88.1.10/32', '10.88.1.11/32', 'fd88:1::11/128']);
    expect(keptHostRoutes({} as never)).toEqual([]);
  });
});
