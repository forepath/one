import type { DataSource } from 'typeorm';

import type { ProjectAccessService } from '../access/project-access.service';
import type { NetworkStateService } from '../services/network-state.service';
import { TopologyService } from './topology.service';

describe('TopologyService structure cache', () => {
  function setup() {
    let revision = 7;
    let placements = 6;
    const dataSource = {
      query: jest.fn(async (sql: string) =>
        sql.includes('desired_revision') ? [{ revision, placements: `${placements}/2026-10-20 12:00:00` }] : [],
      ),
    } as unknown as DataSource;
    const service = new TopologyService(dataSource, {} as ProjectAccessService, {} as NetworkStateService);
    const load = jest
      .spyOn(service as unknown as { load: () => Promise<unknown> }, 'load')
      .mockImplementation(async () => ({
        graph: { elements: [], edges: [] },
        sets: new Map(),
        elementOfAddress: new Map(),
      }));
    const structure = () => (service as unknown as { structure: () => Promise<unknown> }).structure();

    return { structure, load, bump: () => revision++, removePlacement: () => placements-- };
  }

  it('shares the structure within the TTL while the compiled revision is unchanged', async () => {
    const { structure, load } = setup();

    await structure();
    await structure();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads at once after a new compiled revision (e.g. replicas start draining)', async () => {
    const { structure, load, bump } = setup();

    await structure();
    bump();
    await structure();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads at once after a placement change without a new revision', async () => {
    const { structure, load, removePlacement } = setup();

    await structure();
    removePlacement();
    await structure();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
