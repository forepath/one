import { IDENTITY_NOTIFICATION_PUBLISHER, UserRole } from '@forepath/identity/backend';

import {
  CLAIM_ADMIN_CREATED_BY,
  ClaimAdminMembershipService,
  LoadweaverIdentityLifecycleBridgeModule,
  LoadweaverIdentityLifecyclePublisher,
} from './claim-admin.publisher';

const CLAIMER = '11111111-2222-4333-8444-555555555555';

function setup(users: { id: string; role: string }[], existing: unknown = null) {
  const repo = {
    findOne: jest.fn(async () => existing),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => x),
  };
  const manager = { query: jest.fn(async () => users), getRepository: jest.fn(() => repo) };
  const dataSource = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => await fn(manager)) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new ClaimAdminMembershipService(dataSource as never, audit as never);

  return { service, repo, audit, manager };
}

describe('ClaimAdminMembershipService', () => {
  it('makes the claiming (first) account a cluster admin and audits it', async () => {
    const { service, repo, audit } = setup([{ id: CLAIMER, role: UserRole.ADMIN }]);

    await expect(service.grantClaimer(CLAIMER)).resolves.toBe(true);
    expect(repo.save).toHaveBeenCalledWith({
      userId: CLAIMER,
      role: 'cluster-admin',
      createdBy: CLAIM_ADMIN_CREATED_BY,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: { type: 'user', id: CLAIMER },
        action: 'cluster.member.set',
        target: `cluster/member/${CLAIMER}`,
        details: expect.objectContaining({ role: 'cluster-admin', via: 'admin-claim' }),
      }),
    );
  });

  it('grants nothing once a second account exists (admins created later are not claimers)', async () => {
    const { service, repo } = setup([
      { id: CLAIMER, role: UserRole.ADMIN },
      { id: 'other', role: UserRole.ADMIN },
    ]);

    await expect(service.grantClaimer(CLAIMER)).resolves.toBe(false);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('grants nothing to a non-admin or another user, and keeps an existing membership', async () => {
    await expect(setup([{ id: CLAIMER, role: UserRole.USER }]).service.grantClaimer(CLAIMER)).resolves.toBe(false);
    await expect(setup([{ id: 'someone-else', role: UserRole.ADMIN }]).service.grantClaimer(CLAIMER)).resolves.toBe(
      false,
    );

    const kept = setup([{ id: CLAIMER, role: UserRole.ADMIN }], { userId: CLAIMER, role: 'auditor' });

    await expect(kept.service.grantClaimer(CLAIMER)).resolves.toBe(false);
    expect(kept.repo.save).not.toHaveBeenCalled();
  });
});

describe('LoadweaverIdentityLifecyclePublisher', () => {
  it('grants on the creation of an admin account only, fire and forget', async () => {
    const claim = { grantClaimer: jest.fn(async () => true) };
    const publisher = new LoadweaverIdentityLifecyclePublisher(claim as never);

    publisher.publishUserCreated({ id: CLAIMER, email: 'a@b.c', role: UserRole.USER });
    expect(claim.grantClaimer).not.toHaveBeenCalled();

    publisher.publishUserCreated({ id: CLAIMER, email: 'a@b.c', role: UserRole.ADMIN });
    expect(claim.grantClaimer).toHaveBeenCalledWith(CLAIMER);
  });

  it('never throws when the grant fails', async () => {
    const claim = { grantClaimer: jest.fn(async () => Promise.reject(new Error('db down'))) };
    const publisher = new LoadweaverIdentityLifecyclePublisher(claim as never);

    expect(() => publisher.publishUserCreated({ id: CLAIMER, role: UserRole.ADMIN })).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('is wired to the identity notification publisher token', () => {
    const providers = Reflect.getMetadata('providers', LoadweaverIdentityLifecycleBridgeModule) as unknown[];

    expect(providers).toContainEqual({
      provide: IDENTITY_NOTIFICATION_PUBLISHER,
      useExisting: LoadweaverIdentityLifecyclePublisher,
    });
  });
});
