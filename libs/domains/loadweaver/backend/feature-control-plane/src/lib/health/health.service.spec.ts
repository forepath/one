import { IsNull } from 'typeorm';

import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { HealthService } from './health.service';

/** Draining replicas (two-phase removal, M6 gate) stay out of the health tree: their stop is expected. */
describe('HealthService.snapshot', () => {
  it('reads only replicas that are not draining', async () => {
    const queries = new Map<unknown, unknown>();
    const placements = [{ id: 'shop/web/api/0', project: 'shop', deployment: 'web', service: 'api', node: 'n1' }];
    const dataSource = {
      getRepository: (entity: unknown) => ({
        find: async (options?: unknown) => {
          queries.set(entity, options);

          return entity === WorkloadPlacementEntity ? placements : [];
        },
        findOne: async () => null,
      }),
    };
    const service = new HealthService(dataSource as never, {} as never, {} as never);
    const snapshot = await service.snapshot(0);

    expect(queries.get(WorkloadPlacementEntity)).toEqual({ where: { drainUntil: IsNull() } });
    expect(snapshot.replicas.map((r) => r.id)).toEqual(['shop/web/api/0']);
  });
});
