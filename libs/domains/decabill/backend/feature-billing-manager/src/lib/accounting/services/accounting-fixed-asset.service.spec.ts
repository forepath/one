import { AccountingAccountRole as R } from '../constants/accounting.constants';

import { AccountingFixedAssetService } from './accounting-fixed-asset.service';

describe('AccountingFixedAssetService', () => {
  const config = {
    getConfig: jest.fn(() => ({ gwgLimit: 800, assetPoolEnabled: false, assetPoolLower: 250, assetPoolUpper: 1000 })),
  };
  const service = new AccountingFixedAssetService({} as never, config as never, {} as never, {} as never, {} as never);
  const asset = (overrides = {}) =>
    ({
      id: 'a1',
      acquisitionDate: '2026-03-15',
      acquisitionCost: '3600',
      residualValue: '0',
      accumulatedDepreciation: '0',
      depreciatedThrough: null,
      method: 'straight_line',
      usefulLifeMonths: 36,
      status: 'active',
      ...overrides,
    }) as never;

  it('classifies GWG, pool and fixed assets', () => {
    expect(service.classify(500)).toEqual({ method: 'immediate', role: R.LOW_VALUE_ASSETS });
    expect(service.classify(900)).toEqual({ method: 'straight_line', role: R.FIXED_ASSETS });
    config.getConfig.mockReturnValueOnce({
      gwgLimit: 800,
      assetPoolEnabled: true,
      assetPoolLower: 250,
      assetPoolUpper: 1000,
    });
    expect(service.classify(900)).toEqual({ method: 'pool', role: R.ASSET_POOL });
  });

  it('depreciates straight-line monthly pro rata from the acquisition month', () => {
    const plan = service.plannedDepreciation(asset(), '2026-12');

    expect(plan).toHaveLength(10);
    expect(plan[0]).toEqual({ month: '2026-03', amount: 100 });
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBe(1000);
  });

  it('continues after the last run and never exceeds the cost', () => {
    const plan = service.plannedDepreciation(
      asset({ accumulatedDepreciation: '3500', depreciatedThrough: '2029-01' }),
      '2030-12',
    );

    expect(plan).toEqual([{ month: '2029-02', amount: 100 }]);
  });

  it('writes GWG off in full in the acquisition month and pools at 1/5 per year', () => {
    expect(
      service.plannedDepreciation(
        asset({ method: 'immediate', acquisitionCost: '500', usefulLifeMonths: 0 }),
        '2026-12',
      ),
    ).toEqual([{ month: '2026-03', amount: 500 }]);
    expect(
      service.plannedDepreciation(asset({ method: 'pool', acquisitionCost: '900', usefulLifeMonths: 60 }), '2027-12'),
    ).toEqual([
      { month: '2026-12', amount: 180 },
      { month: '2027-12', amount: 180 },
    ]);
  });

  it('books a catch-up run month by month under a row lock (no lumping across a year end, no double run)', async () => {
    const row = asset({ acquisitionDate: '2026-11-01', depreciatedThrough: null });
    const posted: Array<{ documentDate: string; idempotencyKey: string; lines: Array<{ debit?: number }> }> = [];
    const updates: Array<Record<string, unknown>> = [];
    const manager = {
      getRepository: () => ({
        createQueryBuilder: () => {
          const qb = { where: () => qb, setLock: jest.fn(() => qb), getOne: async () => row };

          return qb;
        },
        update: jest.fn(async (_id: string, patch: Record<string, unknown>) => updates.push(patch)),
      }),
    };
    const dataSource = {
      getRepository: () => ({ find: async () => [row] }),
      transaction: async (run: (m: unknown) => unknown) => await run(manager),
    };
    const journal = { post: jest.fn(async (input: (typeof posted)[number]) => posted.push(input)) };
    const charts = {
      requireAccountByRole: async () => ({ id: 'acc-dep' }),
      findAccountByNumber: async () => ({ id: 'acc-asset' }),
    };
    const fiscalYears = { resolvePostingTarget: async () => ({ fiscalYear: { chartId: 'c1' } }) };
    const runner = new AccountingFixedAssetService(
      dataSource as never,
      config as never,
      charts as never,
      fiscalYears as never,
      journal as never,
    );

    await expect(runner.runDepreciation('2027-02', 'admin')).resolves.toEqual({ assets: 1, amount: 400 });

    expect(posted.map((p) => [p.documentDate, p.idempotencyKey, p.lines[0].debit])).toEqual([
      ['2026-11-30', 'fixed_asset:a1:depreciation:2026-11', 100],
      ['2026-12-31', 'fixed_asset:a1:depreciation:2026-12', 100],
      ['2027-01-31', 'fixed_asset:a1:depreciation:2027-01', 100],
      ['2027-02-28', 'fixed_asset:a1:depreciation:2027-02', 100],
    ]);
    expect(updates).toEqual([expect.objectContaining({ accumulatedDepreciation: 400, depreciatedThrough: '2027-02' })]);
  });
});
