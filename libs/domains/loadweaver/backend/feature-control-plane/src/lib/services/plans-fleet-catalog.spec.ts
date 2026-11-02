import { TrustedFleetEntity } from '../fleet-identity/fleet-identity.entities';
import { PlansService } from './plans.service';

/** Plans / drafts (also the fleet's "apply catalog settings" plan) warn about dropping a fixed fleet catalog. */
describe('PlansService: fixed fleet catalog warnings (2026-11-01)', () => {
  const fleets = [
    {
      issuer: 'fleet-1',
      name: 'Acme fleet',
      catalog: { url: 'https://fleet.acme.example', publicKeys: ['k'], name: 'fleet' },
    },
  ];
  const entry = { name: 'fleet', type: 'fleet', url: 'https://fleet.acme.example', enabled: true };
  const cluster = (appStore: unknown) => ({ spec: { network: {}, ...(appStore ? { appStore } : {}) } });

  function setup() {
    const find = jest.fn(async () => fleets);
    const service = Object.create(PlansService.prototype) as PlansService;

    Object.assign(service, {
      dataSource: { getRepository: (e: unknown) => (e === TrustedFleetEntity ? { find } : null) },
    });

    const warnings = (changes: unknown[]) =>
      (service as unknown as { fleetCatalogWarnings: (c: unknown[]) => Promise<unknown[]> }).fleetCatalogWarnings(
        changes,
      );

    return { warnings, find };
  }

  it('warns (without refusing) when a Cluster update removes or disables the entry', async () => {
    const { warnings } = setup();
    const change = (before: unknown, after: unknown) => ({
      action: 'update',
      kind: 'Cluster',
      name: 'cluster',
      project: null,
      before: cluster(before),
      after: cluster(after),
    });

    await expect(warnings([change({ catalogs: [entry] }, { catalogs: [] })])).resolves.toEqual([
      expect.objectContaining({
        level: 'warning',
        path: 'appStore.catalogs',
        message: expect.stringContaining(
          'fleet is managed by fleet Acme fleet; disabling or removing it has no effect',
        ),
      }),
    ]);
    await expect(
      warnings([change({ catalogs: [entry] }, { catalogs: [{ ...entry, enabled: false }] })]),
    ).resolves.toHaveLength(1);
  });

  it('reads nothing when the plan doesn’t change the app store', async () => {
    const { warnings, find } = setup();
    const same = { catalogs: [entry] };

    await expect(
      warnings([
        { action: 'update', kind: 'Cluster', name: 'c', project: null, before: cluster(same), after: cluster(same) },
      ]),
    ).resolves.toEqual([]);
    await expect(
      warnings([{ action: 'create', kind: 'Project', name: 'p', project: null, before: null, after: {} }]),
    ).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
});
