import { BadRequestException } from '@nestjs/common';

import type { ProjectAccessService } from '../access/project-access.service';
import type { ResourceStoreService } from '../services/resource-store.service';
import { ResourcesController } from './resources.controller';

const res = (kind: string, name: string, project?: string) => ({
  apiVersion: 'loadweaver.com/v1',
  kind,
  metadata: { name, ...(project ? { project } : {}) },
  spec: {},
});

describe('ResourcesController.list (reference pickers, 2026-10-29)', () => {
  const all = [
    res('WorkloadGroup', 'web', 'shop'),
    res('WorkloadGroup', 'db', 'shop'),
    res('WorkloadGroup', 'api', 'billing'),
    res('IpPool', 'public-v4'),
  ];
  const store = {
    listAll: jest.fn(async (filter: { kind?: string; project?: string | null }) =>
      all.filter(
        (r) =>
          (!filter.kind || r.kind === filter.kind) &&
          (filter.project === undefined || (r.metadata.project ?? '') === (filter.project ?? '')),
      ),
    ),
  } as unknown as ResourceStoreService;
  const caller = (clusterRole: string | null, projects: Record<string, string>) =>
    ({
      caller: jest
        .fn()
        .mockResolvedValue({ isApiKey: false, clusterRole, projects: new Map(Object.entries(projects)) }),
    }) as unknown as ProjectAccessService;
  const names = (list: { metadata: { name: string } }[]) => list.map((r) => r.metadata.name);

  beforeEach(() => jest.clearAllMocks());

  it('keeps the old behaviour without the new parameters (readable resources only)', async () => {
    const list = await new ResourcesController(store, caller(null, { shop: 'developer' })).list();

    expect(names(list)).toEqual(['web', 'db']);
  });

  it('narrows to one project, still within what the caller may read', async () => {
    const ctrl = new ResourcesController(store, caller(null, { shop: 'viewer' }));

    expect(names(await ctrl.list('WorkloadGroup', undefined, 'shop'))).toEqual(['web', 'db']);
    expect(store.listAll).toHaveBeenCalledWith({ kind: 'WorkloadGroup', project: 'shop' });
    expect(names(await ctrl.list('WorkloadGroup', undefined, 'billing'))).toEqual([]);
  });

  it('filters by a name / project substring and limits the result', async () => {
    const ctrl = new ResourcesController(store, caller('cluster-admin', {}));

    expect(names(await ctrl.list('WorkloadGroup', undefined, undefined, 'W'))).toEqual(['web']);
    expect(names(await ctrl.list('WorkloadGroup', undefined, undefined, 'bill'))).toEqual(['api']);
    expect(names(await ctrl.list(undefined, undefined, undefined, undefined, '2'))).toEqual(['web', 'db']);
  });

  it('does not show cluster-level resources to project members', async () => {
    const list = await new ResourcesController(store, caller(null, { shop: 'admin' })).list('IpPool');

    expect(list).toEqual([]);
  });

  it('rejects an invalid project or limit', async () => {
    const ctrl = new ResourcesController(store, caller('cluster-admin', {}));

    await expect(ctrl.list(undefined, undefined, 'Bad/Name')).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.list(undefined, undefined, undefined, undefined, '0')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(ctrl.list(undefined, undefined, undefined, undefined, 'x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
