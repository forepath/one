import { AuditEventEntity } from '../entities/audit-event.entity';
import {
  actorFromRequest,
  AUDIT_GENESIS_HASH,
  AuditLogService,
  computeAuditHash,
  ON_BEHALF_OF_HEADER,
  ON_BEHALF_OF_SCOPE,
  onBehalfOfFromRequest,
} from './audit-log.service';

function chain(count: number): AuditEventEntity[] {
  const events: AuditEventEntity[] = [];
  let prev = AUDIT_GENESIS_HASH;

  for (let i = 1; i <= count; i++) {
    const body = {
      seq: String(i),
      at: new Date(1_700_000_000_000 + i),
      actorType: 'system' as const,
      actorId: null,
      action: 'x',
      target: `t/${i}`,
      project: null,
      details: { i },
    };
    const hash = computeAuditHash(prev, body);

    events.push(Object.assign(new AuditEventEntity(), body, { prevHash: prev, hash }));
    prev = hash;
  }

  return events;
}

function serviceWith(events: AuditEventEntity[]): AuditLogService {
  const qb = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    params: { from: '1' },
    getMany: jest.fn(),
  };

  qb.where.mockImplementation((_sql: string, params: { from: string }) => {
    qb.params = params;

    return qb;
  });
  qb.getMany.mockImplementation(async () => events.filter((e) => BigInt(e.seq) >= BigInt(qb.params.from)).slice(0, 2));

  return new AuditLogService({ getRepository: () => ({ createQueryBuilder: () => qb }) } as never);
}

describe('AuditLogService', () => {
  it('verifies an intact chain across batches', async () => {
    const events = chain(5);

    await expect(serviceWith(events).verify(2)).resolves.toEqual({ ok: true, checked: 5, head: events[4].hash });
  });

  it('detects modified content, broken links and gaps', async () => {
    const tampered = chain(4);

    tampered[2].details = { i: 99 };
    await expect(serviceWith(tampered).verify(2)).resolves.toMatchObject({ ok: false, brokenAt: '3' });

    const relinked = chain(3);

    relinked[1].prevHash = 'f'.repeat(64);
    await expect(serviceWith(relinked).verify()).resolves.toMatchObject({ ok: false, brokenAt: '2' });

    const gap = chain(3).filter((e) => e.seq !== '2');

    await expect(serviceWith(gap).verify()).resolves.toMatchObject({ ok: false, brokenAt: '3' });
  });

  it('refuses to record outside a transaction', async () => {
    const service = new AuditLogService({} as never);

    await expect(
      service.record({ queryRunner: undefined } as never, { actor: { type: 'system' }, action: 'a', target: 't' }),
    ).rejects.toThrow('inside the transaction');
  });

  it('hashes depend on the previous hash', () => {
    const body = {
      seq: '1',
      at: new Date(0),
      actorType: 'system' as const,
      actorId: null,
      action: 'a',
      target: 't',
      project: null,
      details: {},
    };

    expect(computeAuditHash(AUDIT_GENESIS_HASH, body)).not.toBe(computeAuditHash('1'.repeat(64), body));
  });
});

describe('on behalf of (fleet service, 3.24)', () => {
  const pat = (scopes: string[], header?: string | string[]) =>
    ({
      user: { id: 'svc', amr: ['pat'], scopes },
      headers: header === undefined ? {} : { [ON_BEHALF_OF_HEADER]: header },
    }) as never;

  it('is read only for PATs carrying the opt-in scope', () => {
    expect(onBehalfOfFromRequest(pat([ON_BEHALF_OF_SCOPE], 'fleet:alice@example.com'))).toBe('fleet:alice@example.com');
    expect(onBehalfOfFromRequest(pat(['cluster:read'], 'fleet:alice'))).toBeUndefined();
    expect(
      onBehalfOfFromRequest({
        user: { id: 'u', amr: ['pwd'], scopes: [ON_BEHALF_OF_SCOPE] },
        headers: { [ON_BEHALF_OF_HEADER]: 'x' },
      } as never),
    ).toBeUndefined();
    expect(
      onBehalfOfFromRequest({ apiKeyAuthenticated: true, headers: { [ON_BEHALF_OF_HEADER]: 'x' } } as never),
    ).toBeUndefined();
    expect(onBehalfOfFromRequest(undefined)).toBeUndefined();
  });

  it('drops control characters, trims and caps the value', () => {
    expect(onBehalfOfFromRequest(pat([ON_BEHALF_OF_SCOPE], ' a\nb\u0000c '))).toBe('abc');
    expect(onBehalfOfFromRequest(pat([ON_BEHALF_OF_SCOPE], 'x'.repeat(400)))?.length).toBe(255);
    expect(onBehalfOfFromRequest(pat([ON_BEHALF_OF_SCOPE], ['first', 'second']))).toBe('first');
    expect(onBehalfOfFromRequest(pat([ON_BEHALF_OF_SCOPE], ' \n '))).toBeUndefined();
  });

  it('keeps the service user as the actor and adds onBehalfOf', () => {
    expect(actorFromRequest(pat([ON_BEHALF_OF_SCOPE], 'fleet:alice'))).toEqual({
      type: 'user',
      id: 'svc',
      onBehalfOf: 'fleet:alice',
    });
    expect(actorFromRequest(pat([], 'fleet:alice'))).toEqual({ type: 'user', id: 'svc' });
  });

  it('uses the verified fleet person (3.24) as onBehalfOf and acting person, the service user stays the actor', () => {
    const req = {
      ...(pat([ON_BEHALF_OF_SCOPE], 'fleet:label') as object),
      fleetIdentity: { person: 'fleet:f1:u1', email: 'alice@example.com' },
    } as never;

    expect(actorFromRequest(req)).toEqual({
      type: 'user',
      id: 'svc',
      onBehalfOf: 'fleet:f1:u1',
      person: 'fleet:f1:u1',
      onBehalfOfEmail: 'alice@example.com',
    });
  });

  it('API key with a verified fleet claim (2026-10-29): the actor stays the API key, the person is onBehalfOf', () => {
    const identity = { person: 'fleet:f1:u1', email: 'alice@example.com' };

    expect(actorFromRequest({ apiKeyAuthenticated: true, fleetIdentity: identity } as never)).toEqual({
      type: 'api-key',
      id: null,
      onBehalfOf: 'fleet:f1:u1',
      person: 'fleet:f1:u1',
      onBehalfOfEmail: 'alice@example.com',
    });
    expect(actorFromRequest({ apiKeyAuthenticated: true } as never)).toEqual({ type: 'api-key', id: null });
  });

  it('records onBehalfOf in the details (hashed with the entry)', async () => {
    const saved: Record<string, unknown>[] = [];
    const repo = {
      createQueryBuilder: () => ({ orderBy: () => ({ limit: () => ({ getOne: async () => null }) }) }),
      create: (v: Record<string, unknown>) => v,
      save: async (v: Record<string, unknown>) => {
        saved.push(v);

        return v;
      },
    };
    const manager = { queryRunner: { isTransactionActive: true }, query: jest.fn(), getRepository: () => repo };

    await new AuditLogService({} as never).record(manager as never, {
      actor: { type: 'user', id: 'svc', onBehalfOf: 'fleet:alice' },
      action: 'plan.applied',
      target: 'plan/1',
      details: { plan: '1' },
    });

    expect(saved[0]['details']).toEqual({ plan: '1', onBehalfOf: 'fleet:alice' });

    await new AuditLogService({} as never).record(manager as never, {
      actor: { type: 'user', id: 'svc', onBehalfOf: 'fleet:f1:u1', person: 'fleet:f1:u1', onBehalfOfEmail: 'a@x.io' },
      action: 'plan.approve',
      target: 'plan/1',
    });
    expect(saved[1]['details']).toEqual({ onBehalfOf: 'fleet:f1:u1', onBehalfOfEmail: 'a@x.io' });
    expect(saved[0]['actorId']).toBe('svc');

    await new AuditLogService({} as never).record(manager as never, {
      actor: { type: 'api-key', id: null, onBehalfOf: 'fleet:f1:u1', person: 'fleet:f1:u1' },
      action: 'plan.approve',
      target: 'plan/1',
    });
    expect(saved[2]).toMatchObject({ actorType: 'api-key', actorId: null, details: { onBehalfOf: 'fleet:f1:u1' } });
  });
});
