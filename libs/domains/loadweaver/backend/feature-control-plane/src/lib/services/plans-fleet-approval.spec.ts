import { UserEntity } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import { PlanApprovalEntity } from '../entities/project-access.entity';
import { PlanEntity } from '../entities/plan.entity';
import { FleetPersonEntity } from '../fleet-identity/fleet-identity.entities';
import { PlansService } from './plans.service';

/** Plan approvals through a fleet (3.24): verified persons, the two-person rule and legacy plans. */
describe('PlansService.approve through a fleet (3.24)', () => {
  const svcPat = { id: 'svc', amr: ['pat'], scopes: ['fleet:on-behalf-of'] };
  const person = (sub: string, email = `${sub}@example.com`) => ({
    person: `fleet:f1:${sub}`,
    issuer: 'f1',
    subject: sub,
    email,
    emailVerified: true,
    role: 'operator' as const,
    projects: {},
  });

  function setup(createdBy: string, persons: Record<string, { email: string }> = {}) {
    const plan = {
      id: 'p1',
      status: 'pending',
      createdBy,
      changes: [{ action: 'update', kind: 'Deployment', name: 'web', project: 'shop', after: {} }],
      source: null,
      createdAt: new Date(),
    } as unknown as PlanEntity;
    const approvals: Record<string, unknown>[] = [];
    const repos = new Map<unknown, unknown>([
      [PlanEntity, { findOne: async () => plan }],
      [
        PlanApprovalEntity,
        {
          create: (x: Record<string, unknown>) => ({ ...x, createdAt: new Date() }),
          save: async (x: Record<string, unknown>) => approvals.push(x),
          find: async () => approvals,
        },
      ],
      [
        FleetPersonEntity,
        {
          findOne: async ({ where }: { where: { personId: string } }) =>
            persons[where.personId] ? { ...persons[where.personId], emailVerified: true } : null,
          // The batched label lookup of the response (author / approvers).
          find: async ({ where }: { where: { personId: { _value: string[] } } }) =>
            where.personId._value
              .filter((id) => persons[id])
              .map((id) => ({ personId: id, ...persons[id], emailVerified: true })),
        },
      ],
      [UserEntity, { findOne: async () => null, find: async () => [] }],
    ]);
    const manager = { getRepository: (e: unknown) => repos.get(e) };
    const service = Object.create(PlansService.prototype) as PlansService;

    Object.assign(service, {
      dataSource: { transaction: async (fn: (m: unknown) => Promise<unknown>) => await fn(manager) },
      projectAccess: {
        caller: async (req: { fleetIdentity?: { person: string }; apiKeyAuthenticated?: boolean }) => ({
          userId: req.fleetIdentity?.person ?? (req.apiKeyAuthenticated ? undefined : 'svc'),
          isApiKey: false,
          clusterRole: 'infra-operator',
          projects: new Map([['shop', 'operator']]),
        }),
      },
      audit: { record: jest.fn() },
      events: { planStatus: jest.fn() },
    });

    return { service, approvals };
  }

  it('records the approval of a second verified person', async () => {
    const { service, approvals } = setup('fleet:f1:alice', { 'fleet:f1:bob': { email: 'bob@example.com' } });

    const response = await service.approve('p1', { user: svcPat, fleetIdentity: person('bob') } as never);

    expect(approvals).toEqual([expect.objectContaining({ userId: 'fleet:f1:bob', project: 'shop', via: 'fleet' })]);
    // The response names the people (verified fleet email; none known for the author).
    expect(response.createdByEmail).toBeNull();
    expect(response.approvals).toEqual([
      expect.objectContaining({ userId: 'fleet:f1:bob', userEmail: 'bob@example.com' }),
    ]);
  });

  it('refuses the author, also as another fleet account with the same verified email', async () => {
    await expect(
      setup('fleet:f1:alice').service.approve('p1', { user: svcPat, fleetIdentity: person('alice') } as never),
    ).rejects.toThrow(ForbiddenException);

    const { service } = setup('fleet:f1:alice', {
      'fleet:f1:alice': { email: 'alice@example.com' },
      'fleet:f1:alice2': { email: 'alice@example.com' },
    });

    await expect(
      service.approve('p1', { user: svcPat, fleetIdentity: person('alice2', 'alice@example.com') } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a fleet service user without a verified person, and legacy plans of the service user', async () => {
    await expect(setup('fleet:f1:alice').service.approve('p1', { user: svcPat } as never)).rejects.toThrow(
      /verified fleet identity/,
    );
    await expect(
      setup('svc').service.approve('p1', { user: svcPat, fleetIdentity: person('bob') } as never),
    ).rejects.toThrow(/cluster’s own console/);
  });

  describe('through the cluster API key (2026-10-29, API key fleet delegation)', () => {
    const apiKey = (sub?: string, email?: string) =>
      ({ apiKeyAuthenticated: true, ...(sub ? { fleetIdentity: person(sub, email) } : {}) }) as never;

    it('records the approval of a second verified person', async () => {
      const { service, approvals } = setup('fleet:f1:alice');

      await service.approve('p1', apiKey('bob'));
      expect(approvals).toEqual([expect.objectContaining({ userId: 'fleet:f1:bob', via: 'fleet' })]);
    });

    it('refuses the author, also as another fleet account with the same verified email', async () => {
      await expect(setup('fleet:f1:alice').service.approve('p1', apiKey('alice'))).rejects.toThrow(ForbiddenException);

      const { service } = setup('fleet:f1:alice', {
        'fleet:f1:alice': { email: 'alice@example.com' },
        'fleet:f1:alice2': { email: 'alice@example.com' },
      });

      await expect(service.approve('p1', apiKey('alice2', 'alice@example.com'))).rejects.toThrow(ForbiddenException);
    });

    it('keeps plans the API key created without a person native-only', async () => {
      await expect(setup('api-key').service.approve('p1', apiKey('bob'))).rejects.toThrow(/cluster’s own console/);
    });
  });
});
