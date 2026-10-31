import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

import { AuditService } from './audit.service';

/**
 * Full-text audit filter without a log store (ILIKE fallback): the object history tab of resources without their own
 * audit target (e.g. a workload group) asks `GET /audit?text=<name>&project=<project>` — it answered 500 because the
 * `:text` parameter also bound the `::text` cast of `details` (UI/UX sweep LW-25, 2026-10-29).
 */
describe('AuditService.list: text filter (ILIKE fallback)', () => {
  function setup() {
    const clauses: { sql: string; params: Record<string, unknown> }[] = [];
    const query = {
      andWhere: jest.fn((sql: string, params: Record<string, unknown> = {}) => {
        clauses.push({ sql, params });

        return query;
      }),
      orderBy: jest.fn(() => query),
      limit: jest.fn(() => query),
      getMany: jest.fn(async () => []),
    };
    const dataSource = { getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => query) })) };
    const access = { caller: jest.fn(async () => ({ clusterRole: 'cluster-admin', projects: new Map() })) };
    const opensearch = { isEnabled: jest.fn(() => false), indexName: jest.fn((name: string) => name) };
    const svc = new AuditService(dataSource as never, access as never, opensearch as never, {} as never);

    return { svc, clauses };
  }

  /** The SQL TypeORM's Postgres driver sends for a clause (same parameter replacement as at runtime). */
  function render(sql: string, params: Record<string, unknown>): string {
    const driver = Object.assign(Object.create(PostgresDriver.prototype) as PostgresDriver, { parametersPrefix: '$' });

    return driver.escapeQueryWithParameters(sql, params, {})[0];
  }

  it('keeps the ::text cast of details intact and escapes LIKE wildcards', async () => {
    const { svc, clauses } = setup();

    await expect(svc.list(undefined, { text: 'db_1%', project: 'shop' })).resolves.toEqual({
      entries: [],
      before: null,
    });

    const text = clauses.find((clause) => clause.sql.includes('ILIKE'));

    expect(text).toBeDefined();

    const sql = render(text!.sql, text!.params);

    expect(sql).toContain('a.details::text ILIKE $1');
    expect(sql).not.toMatch(/details:\$/);
    expect(Object.values(text!.params)).toEqual(['%db\\_1\\%%']);
  });

  it('every clause of a full filter renders without a parameter inside a cast', async () => {
    const { svc, clauses } = setup();

    await svc.list(undefined, { text: 'db', project: 'shop', action: 'plan.*', target: 'node/', before: '42' });

    for (const clause of clauses) expect(render(clause.sql, clause.params)).not.toMatch(/::?\$\d/);
  });
});
