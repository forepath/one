import { AuthService } from '@forepath/identity/backend';
import type { ModuleRef } from '@nestjs/core';

import type { ProjectAccessService } from '../access/project-access.service';
import { AccessController } from './access.controller';

describe('AccessController.me', () => {
  const access = (clusterRole: string | null) =>
    ({
      caller: jest.fn().mockResolvedValue({ userId: 'u1', clusterRole, projects: new Map([['web', 'developer']]) }),
    }) as unknown as ProjectAccessService;
  const moduleRef = (suspended: boolean | 'missing') =>
    ({
      get: jest.fn((token: unknown) => {
        if (suspended === 'missing' || token !== AuthService) throw new Error('not found');

        return { isEmailLogin2faSuspended: () => suspended };
      }),
    }) as unknown as ModuleRef;

  it('reports suspended email login 2FA (no SMTP) to cluster admins', async () => {
    await expect(new AccessController(access('cluster-admin'), moduleRef(true)).me()).resolves.toEqual({
      userId: 'u1',
      clusterRole: 'cluster-admin',
      projects: { web: 'developer' },
      emailLogin2faSuspended: true,
    });
  });

  it('is false when SMTP is configured', async () => {
    const me = await new AccessController(access('cluster-admin'), moduleRef(false)).me();

    expect(me.emailLogin2faSuspended).toBe(false);
  });

  it('is false for callers who are not cluster admins', async () => {
    const me = await new AccessController(access('auditor'), moduleRef(true)).me();

    expect(me.emailLogin2faSuspended).toBe(false);
  });

  it('is false without users authentication (no identity AuthService)', async () => {
    const me = await new AccessController(access('cluster-admin'), moduleRef('missing')).me();

    expect(me.emailLogin2faSuspended).toBe(false);
  });
});
