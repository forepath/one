import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import type { AccessCaller } from '../access/access.utils';
import type { ProjectAccessService } from '../access/project-access.service';
import { UsageService } from './usage.service';
import { PROJECT_EGRESS_OWNER } from './usage.utils';

function setup(caller: Partial<AccessCaller> = {}) {
  const query = jest.fn().mockResolvedValue([]);
  const managerQuery = jest.fn().mockResolvedValue([{ locked: true }]);
  const dataSource = {
    query,
    transaction: jest.fn(async (fn: (m: { query: jest.Mock }) => Promise<void>) => await fn({ query: managerQuery })),
    getRepository: jest.fn(() => ({ find: jest.fn().mockResolvedValue([{ clusterId: 'lab' }]) })),
  };
  const access = {
    caller: jest.fn().mockResolvedValue({ isApiKey: false, projects: new Map(), ...caller }),
    assertRead: jest.fn().mockResolvedValue({}),
  };
  const service = new UsageService(dataSource as never, access as unknown as ProjectAccessService);

  return { service, query, managerQuery, access };
}

const now = new Date('2026-10-20T13:37:00Z');

describe('UsageService (3.24)', () => {
  describe('scoping', () => {
    it('refuses cluster-wide usage without a cluster role', async () => {
      const { service, query } = setup({ projects: new Map([['shop', 'admin']]) });

      await expect(service.forCluster(undefined, {})).rejects.toBeInstanceOf(ForbiddenException);
      expect(query).not.toHaveBeenCalled();
    });

    it('serves cluster-wide usage to auditors (Decabill collector) with the billing filter', async () => {
      const { service, query } = setup({ clusterRole: 'auditor' });

      await service.forCluster(undefined, {
        billingSubscription: '6f1c1d5e-6a43-4c38-9a59-7f6d4f0e2a10',
        granularity: 'hour',
        from: '2026-10-20T00:00:00Z',
        to: '2026-10-20T12:00:00Z',
        finalOnly: true,
      });

      const [sql, params] = query.mock.calls[0];

      expect(sql).toContain('billing_subscription = $3');
      expect(sql).toContain('AND final');
      expect(params).toEqual([
        new Date('2026-10-20T00:00:00Z'),
        new Date('2026-10-20T12:00:00Z'),
        '6f1c1d5e-6a43-4c38-9a59-7f6d4f0e2a10',
        'hour',
      ]);
      // The totals query has the same filters without the granularity.
      expect(query.mock.calls[1][1]).toEqual(params.slice(0, 3));
    });

    it('checks project read access and restricts to the project', async () => {
      const { service, query, access } = setup();

      await service.forProject(undefined, 'shop', { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });

      expect(access.assertRead).toHaveBeenCalledWith(undefined, 'shop');
      expect(query.mock.calls[0][0]).toContain('project = ANY($3)');
      expect(query.mock.calls[0][1][2]).toEqual(['shop']);
    });

    it('does not query when the project is not readable', async () => {
      const { service, query, access } = setup();

      access.assertRead.mockRejectedValue(new NotFoundException('project not found'));

      await expect(service.forProject(undefined, 'other', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('report', () => {
    it('answers 503 instead of a placeholder cluster id while the cluster row is missing (M6)', async () => {
      const dataSource = {
        query: jest.fn().mockResolvedValue([]),
        getRepository: jest.fn(() => ({ find: jest.fn().mockResolvedValue([]) })),
      };
      const access = {
        caller: jest.fn().mockResolvedValue({ isApiKey: false, projects: new Map(), clusterRole: 'auditor' }),
        assertRead: jest.fn().mockResolvedValue({}),
      };
      const service = new UsageService(dataSource as never, access as unknown as ProjectAccessService);

      await expect(
        service.report({ granularity: 'hour', from: '2026-10-20T11:00:00Z', to: '2026-10-20T12:00:00Z' }, now),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('maps hourly rows with idempotency keys and billing mapping', async () => {
      const { service, query } = setup();

      query
        .mockResolvedValueOnce([
          {
            project: 'shop',
            meter: 'cpu_core_hours',
            b: new Date('2026-10-20T11:00:00Z'),
            value: '1.23456789',
            final: true,
            billing_subscription: 'sub',
          },
        ])
        .mockResolvedValueOnce([{ project: 'shop', meter: 'cpu_core_hours', value: '1.23456789' }]);

      const report = await service.report(
        { granularity: 'hour', from: '2026-10-20T11:00:00Z', to: '2026-10-20T12:00:00Z' },
        now,
      );

      expect(report.cluster).toBe('lab');
      expect(report.rows).toEqual([
        {
          project: 'shop',
          bucket: '2026-10-20T11:00:00.000Z',
          meter: 'cpu_core_hours',
          value: 1.234568,
          final: true,
          idempotencyKey: 'loadweaver:lab:shop:cpu_core_hours:2026-10-20T11:00:00.000Z',
          billingSubscription: 'sub',
        },
      ]);
      expect(report.totals).toEqual([{ project: 'shop', meter: 'cpu_core_hours', value: 1.234568 }]);
      expect(report.truncated).toBe(false);
      expect(report.meters).toHaveLength(7);
    });

    it('keeps the current day open even when all its hours so far are final', async () => {
      const { service, query } = setup();

      query
        .mockResolvedValueOnce([
          { project: 'shop', meter: 'memory_gib_hours', b: new Date('2026-10-19T00:00:00Z'), value: 24, final: true },
          { project: 'shop', meter: 'memory_gib_hours', b: new Date('2026-10-20T00:00:00Z'), value: 13, final: true },
        ])
        .mockResolvedValueOnce([]);

      const report = await service.report({ granularity: 'day', from: '2026-10-19T00:00:00Z' }, now);

      expect(report.rows.map((r) => [r.bucket.slice(0, 10), r.final, r.idempotencyKey])).toEqual([
        ['2026-10-19', true, undefined],
        ['2026-10-20', false, undefined],
      ]);
    });

    it('filters by meter and limits the catalog to it', async () => {
      const { service, query } = setup();
      const report = await service.report({ meter: 'traffic_out_gb' }, now);

      expect(query.mock.calls[0][0]).toContain('meter = $3');
      expect(report.meters.map((m) => m.key)).toEqual(['traffic_out_gb']);
    });
  });

  describe('jobs', () => {
    it('samples allocations into 5-minute slots', async () => {
      const { service, query } = setup();

      await service.sample(new Date('2026-10-20T13:37:42Z'));

      expect(query.mock.calls[0][0]).toContain('ON CONFLICT ("time", project, input) DO NOTHING');
      expect(query.mock.calls[0][1]).toEqual([new Date('2026-10-20T13:35:00Z'), PROJECT_EGRESS_OWNER]);
    });

    it('recomputes open buckets of the last 3 hours with each meter’s factor, then finalizes', async () => {
      const { service, managerQuery } = setup();

      await service.rollup(now);

      const [sql, params] = managerQuery.mock.calls[1];

      expect(sql).toContain('WHERE NOT lw_usage_1h.final');
      expect(params[0]).toEqual(new Date('2026-10-20T10:00:00Z'));
      expect(params[1]).toEqual([
        'replica.cpu_seconds',
        'replica.memory_byte_seconds',
        'replica.net_rx_bytes',
        'replica.net_tx_bytes',
      ]);
      expect(params[2]).toEqual(['cpu_core_hours', 'memory_gib_hours', 'traffic_in_gb', 'traffic_out_gb']);
      // N-1 agents: instantaneous samples × 10 s, only for replica minutes without integrated samples.
      expect(params[9]).toEqual([
        'replica.cpu_cores',
        'replica.memory_bytes',
        'replica.net_rx_bytes_per_s',
        'replica.net_tx_bytes_per_s',
      ]);
      expect(params[10]).toEqual([10 / 3600, 10 / 3600 / 1024 ** 3, 10 / 1e9, 10 / 1e9]);
      expect(sql).toContain('NOT EXISTS');
      expect(sql).not.toMatch(/sum\(m\.avg \* m\.samples\) \* d\.factor/);
      expect(params[4]).toEqual(['storage_gib', 'storage_replica_gib', 'public_ips']);
      expect(params[7]).toBe('900 seconds');
      expect(params[8]).toBe(now);
      expect(managerQuery.mock.calls[2][0]).toContain('UPDATE lw_usage_1h SET final = true');
    });

    it('leaves the roll-up to the replica holding the lock', async () => {
      const { service, managerQuery } = setup();

      managerQuery.mockResolvedValueOnce([{ locked: false }]);
      await service.rollup(now);

      expect(managerQuery).toHaveBeenCalledTimes(1);
    });
  });
});
