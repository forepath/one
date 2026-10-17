import { X509Certificate } from 'node:crypto';

import {
  decodeControlPlaneMessage,
  type DesiredState,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCertificateAuthority, type CertificateAuthority } from '@forepath/loadweaver/shared/util-pki';

import { AgentStreamServer } from '../agent-stream/agent-stream.server';
import type { AgentSession } from '../agent-stream/agent-session.registry';
import { ClusterEntity } from '../entities/cluster.entity';
import { NodeEntity } from '../entities/node.entity';
import { PostgresCertificateEntity } from '../entities/postgres-certificate.entity';
import { ClusterIdentityService, issuePostgresServerCertificate } from './cluster-identity.service';
import { NetworkStateService } from './network-state.service';
import { PostgresCertificateRenewalService } from './postgres-certificate-renewal.service';
import {
  caFingerprint,
  memberPostgresCertificate,
  membersDueForRenewal,
  postgresCertificateDue,
  postgresCertificateProblem,
  type PostgresCertificateStore,
  type StoredPostgresCertificate,
} from './postgres-certificates';

/**
 * M6 gate: members' Postgres server certificates are stored and reused (identical desired states across pushes and
 * replicas), renewed with a third of the lifetime left, and a daily timer re-pushes to members whose certificate is
 * due even when nothing else changes.
 */
const DAY = 24 * 60 * 60 * 1000;

function memoryStore(): PostgresCertificateStore & { rows: Map<string, StoredPostgresCertificate> } {
  const rows = new Map<string, StoredPostgresCertificate>();

  return {
    rows,
    load: async (nodeName) => rows.get(nodeName) ?? null,
    replace: async (next, previous) => {
      const stored = rows.get(next.nodeName) ?? null;

      if ((stored?.serial ?? null) === (previous?.serial ?? null)) rows.set(next.nodeName, next);

      return rows.get(next.nodeName) as StoredPostgresCertificate;
    },
  };
}

describe('member Postgres server certificates (stored, reused, renewed)', () => {
  let ca: CertificateAuthority;
  let other: CertificateAuthority;

  beforeAll(async () => {
    ca = await createCertificateAuthority({ commonName: 'Loadweaver cluster CA lw-abc', validityDays: 3650 });
    other = await createCertificateAuthority({ commonName: 'Loadweaver cluster CA lw-new', validityDays: 3650 });
  });

  const issuer = (authority: () => CertificateAuthority, now: Date, count: { n: number }) => async () => {
    count.n++;

    return await issuePostgresServerCertificate(authority(), 'lw-abc', 'n2', '10.93.0.2', now);
  };

  it('pushes the same certificate twice (no new key per push)', async () => {
    const store = memoryStore();
    const issued = { n: 0 };
    const now = new Date();
    const first = await memberPostgresCertificate(
      store,
      issuer(() => ca, now, issued),
      'n2',
      '10.93.0.2',
      ca.certificatePem,
      now,
    );
    const second = await memberPostgresCertificate(
      store,
      issuer(() => ca, now, issued),
      'n2',
      '10.93.0.2',
      ca.certificatePem,
      new Date(now.getTime() + 60_000),
    );

    expect(first.issued).toBe(true);
    expect(second.issued).toBe(false);
    expect(second.tls).toEqual(first.tls);
    expect(issued.n).toBe(1);
  });

  it('renews once two thirds of the lifetime passed (a third left, like the agent)', async () => {
    const store = memoryStore();
    const issued = { n: 0 };
    const start = new Date('2026-10-20T00:00:00Z');
    const first = await memberPostgresCertificate(
      store,
      issuer(() => ca, start, issued),
      'n2',
      '10.93.0.2',
      ca.certificatePem,
      start,
    );
    const stored = store.rows.get('n2') as StoredPostgresCertificate;
    const lifetime = stored.notAfter.getTime() - stored.notBefore.getTime();
    const at = (fraction: number) => new Date(stored.notBefore.getTime() + lifetime * fraction);

    expect(postgresCertificateProblem(stored, '10.93.0.2', ca.certificatePem, at(0.6))).toBeNull();
    expect(postgresCertificateDue(stored, at(0.66))).toBe(false);
    expect(postgresCertificateDue(stored, at(0.67))).toBe(true);
    expect(postgresCertificateProblem(stored, '10.93.0.2', ca.certificatePem, at(0.67))).toBe(
      'less than a third of its lifetime left',
    );

    const before = await memberPostgresCertificate(
      store,
      issuer(() => ca, at(0.6), issued),
      'n2',
      '10.93.0.2',
      ca.certificatePem,
      at(0.6),
    );
    const renewed = await memberPostgresCertificate(
      store,
      issuer(() => ca, at(0.7), issued),
      'n2',
      '10.93.0.2',
      ca.certificatePem,
      at(0.7),
    );

    expect(before.tls).toEqual(first.tls);
    expect(renewed.issued).toBe(true);
    expect(renewed.tls.certificatePem).not.toBe(first.tls.certificatePem);
    expect(new Date(new X509Certificate(renewed.tls.certificatePem).validTo).getTime()).toBeGreaterThan(
      stored.notAfter.getTime(),
    );
    expect(issued.n).toBe(2);
  });

  it('issues a new certificate when the member address or the CA changes', async () => {
    const store = memoryStore();
    const issued = { n: 0 };
    const now = new Date();
    const first = await memberPostgresCertificate(
      store,
      issuer(() => ca, now, issued),
      'n2',
      '10.93.0.2',
      ca.certificatePem,
      now,
    );
    const stored = store.rows.get('n2') as StoredPostgresCertificate;

    expect(postgresCertificateProblem(stored, '10.93.0.9', ca.certificatePem, now)).toBe(
      'issued for 10.93.0.2, member address is 10.93.0.9',
    );
    expect(postgresCertificateProblem(stored, '10.93.0.2', other.certificatePem, now)).toBe('issued by another CA');

    const moved = await memberPostgresCertificate(
      store,
      async () => {
        issued.n++;

        return await issuePostgresServerCertificate(ca, 'lw-abc', 'n2', '10.93.0.9', now);
      },
      'n2',
      '10.93.0.9',
      ca.certificatePem,
      now,
    );

    expect(moved.issued).toBe(true);
    expect(new X509Certificate(moved.tls.certificatePem).checkIP('10.93.0.9')).toBe('10.93.0.9');
    expect(moved.tls.certificatePem).not.toBe(first.tls.certificatePem);
    expect(store.rows.get('n2')?.address).toBe('10.93.0.9');

    const rekeyed = await memberPostgresCertificate(
      store,
      issuer(() => other, now, issued),
      'n2',
      '10.93.0.9',
      other.certificatePem,
      now,
    );

    expect(rekeyed.issued).toBe(true);
    expect(store.rows.get('n2')?.caFingerprint).toBe(caFingerprint(other.certificatePem));
    expect(rekeyed.tls.caCertificatePem).toBe(other.certificatePem);
  });

  it('lets concurrent replicas agree on one certificate (compare-and-swap)', async () => {
    const store = memoryStore();
    const now = new Date();
    const [a, b] = await Promise.all([
      memberPostgresCertificate(
        store,
        issuer(() => ca, now, { n: 0 }),
        'n2',
        '10.93.0.2',
        ca.certificatePem,
        now,
      ),
      memberPostgresCertificate(
        store,
        issuer(() => ca, now, { n: 0 }),
        'n2',
        '10.93.0.2',
        ca.certificatePem,
        now,
      ),
    ]);

    expect(a.tls).toEqual(b.tls);
    expect(a.tls.certificatePem).toBe(store.rows.get('n2')?.certificatePem);
  });

  it('selects members whose stored certificate passed two thirds of its lifetime for the renewal timer', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const cert = (nodeName: string, ageDays: number) => ({
      nodeName,
      notBefore: new Date(now.getTime() - ageDays * DAY),
      notAfter: new Date(now.getTime() + (365 - ageDays) * DAY),
    });

    expect(
      membersDueForRenewal(
        [cert('n1', 100), cert('n2', 250), cert('n3', 400), cert('gone', 300)],
        new Set(['n1', 'n2', 'n3']),
        now,
      ),
    ).toEqual(['n2', 'n3']);
  });
});

describe('PostgresCertificateRenewalService (daily timer)', () => {
  const now = new Date('2026-10-20T00:00:00Z');

  function setup(locked: boolean) {
    const network = { repush: jest.fn(async () => 42) };
    const manager = {
      query: jest.fn(async () => [{ locked }]),
      getRepository: (entity: unknown) => ({
        find: async () =>
          entity === NodeEntity
            ? [{ name: 'n1' }, { name: 'n2' }]
            : [
                {
                  nodeName: 'n1',
                  notBefore: new Date(now.getTime() - 10 * DAY),
                  notAfter: new Date(now.getTime() + 355 * DAY),
                },
                {
                  nodeName: 'n2',
                  notBefore: new Date(now.getTime() - 300 * DAY),
                  notAfter: new Date(now.getTime() + 65 * DAY),
                },
              ],
      }),
    };
    const dataSource = { transaction: async (fn: (m: typeof manager) => Promise<unknown>) => await fn(manager) };

    return { service: new PostgresCertificateRenewalService(dataSource as never, network as never), network };
  }

  it('re-pushes to members whose certificate is due', async () => {
    const { service, network } = setup(true);

    expect(await service.tick(now)).toEqual(['n2']);
    expect(network.repush).toHaveBeenCalledWith(['n2'], 'Postgres server certificate renewal');
  });

  it('does nothing on replicas without the leader lock', async () => {
    const { service, network } = setup(false);

    expect(await service.tick(now)).toEqual([]);
    expect(network.repush).not.toHaveBeenCalled();
  });
});

describe('desired-state pushes with a member Postgres certificate', () => {
  /** In-memory `lw_postgres_certificates` + the cluster row, as `ClusterIdentityService` uses them. */
  function identityWith(ca: CertificateAuthority) {
    const rows = new Map<string, Record<string, unknown>>();
    const certificates = {
      findOne: async ({ where }: { where: { nodeName: string } }) => rows.get(where.nodeName) ?? null,
      findOneOrFail: async ({ where }: { where: { nodeName: string } }) => rows.get(where.nodeName),
      update: async (where: { nodeName: string; serial: string }, fields: Record<string, unknown>) => {
        const row = rows.get(where.nodeName);

        if (row && row['serial'] === where.serial) rows.set(where.nodeName, { ...row, ...fields });
      },
      createQueryBuilder: () => {
        let values: Record<string, unknown> = {};
        const qb = {
          insert: () => qb,
          into: () => qb,
          values: (v: Record<string, unknown>) => ((values = v), qb),
          orIgnore: () => qb,
          execute: async () => {
            if (!rows.has(values['nodeName'] as string)) rows.set(values['nodeName'] as string, values);
          },
        };

        return qb;
      },
    };
    const cluster = { clusterId: 'lw-abc', caCertificate: ca.certificatePem, caPrivateKey: ca.privateKeyPem };
    const dataSource = {
      getRepository: (entity: unknown) =>
        entity === ClusterEntity
          ? { findOneOrFail: async () => cluster }
          : entity === PostgresCertificateEntity
            ? certificates
            : null,
    };

    return { identity: new ClusterIdentityService(dataSource as never), rows };
  }

  const state = {
    revision: 7,
    network: {
      node: 'n2',
      addresses: ['10.93.0.2'],
      wireguard: [],
      services: [],
      bgp: { asn: 64512, routerId: '10.93.0.2', routeReflector: false, originate: [], sessions: [] },
      firewall: { sets: {}, rules: [] },
      dns: { domain: 'lw', records: [], visibility: {} },
    },
    controlPlane: {
      role: 'member',
      members: [
        { name: 'n1', address: '10.93.0.1', witness: false },
        { name: 'n2', address: '10.93.0.2', witness: false },
      ],
      automaticFailover: true,
      scope: 'lw-abc',
    },
    lifecycle: 'active',
  } as unknown as DesiredState;

  function server(identity: ClusterIdentityService) {
    const network = { getDesiredState: async () => state };
    const args: unknown[] = [{}, identity, {}, network, ...Array.from({ length: 17 }, () => ({}))];

    return new (AgentStreamServer as unknown as new (...a: unknown[]) => AgentStreamServer)(...args);
  }

  function session() {
    const sent: Envelope[] = [];
    const s = {
      nodeName: 'n2',
      sentRevision: -1,
      protocol: { version: 1, features: new Set(['postgres-tls']) },
      send: (e: Envelope) => sent.push(e),
    } as unknown as AgentSession;

    return { s, sent };
  }

  const payload = (e: Envelope) => {
    const decoded = decodeControlPlaneMessage(e);

    if (!decoded.ok) throw new Error(JSON.stringify(decoded));

    return decoded.message.payload as DesiredState;
  };

  it('pushes byte-identical desired states (same certificate) on every push and from every replica', async () => {
    const ca = await createCertificateAuthority({ commonName: 'Loadweaver cluster CA lw-abc', validityDays: 3650 });
    const { identity, rows } = identityWith(ca);
    const replicaA = server(identity);
    const replicaB = server(identity);
    const first = session();
    const second = session();

    await replicaA.pushDesiredState(first.s);
    // A reconnect: the session pushes again.
    first.s.sentRevision = -1;
    await replicaA.pushDesiredState(first.s);
    await replicaB.pushDesiredState(second.s);

    const [a, b] = first.sent.map(payload);
    const c = payload(second.sent[0]);

    expect(a.controlPlane.postgresTls?.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    expect(rows.size).toBe(1);
  });
});

describe('NetworkStateService.repush (renewal without other changes)', () => {
  it('re-announces the unchanged desired states of the due members under a new revision', async () => {
    const rows = new Map<string, { nodeName: string; revision: number; state: Record<string, unknown> }>([
      ['n2', { nodeName: 'n2', revision: 5, state: { revision: 5, lifecycle: 'active' } }],
      ['n3', { nodeName: 'n3', revision: 6, state: { revision: 6, lifecycle: 'active' } }],
    ]);
    const cluster = { id: 'c', desiredRevision: 9 };
    const queries: unknown[][] = [];
    const manager = {
      query: async (sql: string, params: unknown[]) => queries.push([sql, ...params]),
      getRepository: (entity: { name: string }) =>
        entity.name === 'NodeDesiredStateEntity'
          ? {
              find: async () => [rows.get('n2')],
              update: async (
                where: { nodeName: string },
                values: { revision: number; state: Record<string, unknown> },
              ) => rows.set(where.nodeName, { nodeName: where.nodeName, ...values }),
            }
          : {
              findOneOrFail: async () => cluster,
              update: async (_: unknown, values: { desiredRevision: number }) => Object.assign(cluster, values),
            },
    };
    const dataSource = { transaction: async (fn: (m: typeof manager) => Promise<unknown>) => await fn(manager) };
    const network = new NetworkStateService(dataSource as never, {} as never, {} as never, {} as never, {} as never);

    expect(await network.repush(['n2'], 'test')).toBe(10);
    expect(rows.get('n2')).toEqual({ nodeName: 'n2', revision: 10, state: { revision: 10, lifecycle: 'active' } });
    expect(rows.get('n3')?.revision).toBe(6);
    expect(cluster.desiredRevision).toBe(10);
    expect(queries).toContainEqual(['SELECT pg_notify($1, $2)', 'lw_desired_state', '10']);
    expect(await network.repush([], 'nothing')).toBeNull();
  });
});
