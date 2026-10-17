import { desiredState } from '../test-fixtures';
import { ReconcilerService } from './reconciler.service';

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
    volumes: ok(false),
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
    state: { saveAppliedState: jest.fn(), appliedState: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

function reconciler(d: ReturnType<typeof deps>): ReconcilerService {
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
