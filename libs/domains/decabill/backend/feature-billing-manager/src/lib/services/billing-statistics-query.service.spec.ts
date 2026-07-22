import { BillingStatisticsQueryService } from './billing-statistics-query.service';

describe('BillingStatisticsQueryService', () => {
  const invoicesRepository = {
    sumPaidGrossByPeriod: jest.fn(),
    countPaidInPeriod: jest.fn(),
    sumByPlanInPeriod: jest.fn(),
    sumByBuyerCountryInPeriod: jest.fn(),
  };
  const service = new BillingStatisticsQueryService(invoicesRepository as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('getSummary returns series and totals', async () => {
    const from = new Date('2025-01-01');
    const to = new Date('2025-01-31');

    invoicesRepository.sumPaidGrossByPeriod.mockResolvedValue([
      { period: '2025-01-01', totalGross: 100 },
      { period: '2025-01-02', totalGross: 50 },
    ]);
    invoicesRepository.countPaidInPeriod.mockResolvedValue(3);

    const result = await service.getSummary({ from, to, groupBy: 'day' });

    expect(result.totalGross).toBe(150);
    expect(result.paidCount).toBe(3);
    expect(result.series).toHaveLength(2);
  });

  it('getByProduct returns plan breakdown', async () => {
    const from = new Date('2025-01-01');
    const to = new Date('2025-01-31');

    invoicesRepository.sumByPlanInPeriod.mockResolvedValue([
      { planId: 'plan-1', planName: 'Basic', totalGross: 200 },
      { planId: 'project:proj-1', planName: 'Client Project', totalGross: 150 },
      { planId: 'UNKNOWN', planName: 'Unknown', totalGross: 50 },
    ]);

    const result = await service.getByProduct({ from, to });

    expect(result.totalGross).toBe(400);
    expect(result.items[0].planName).toBe('Basic');
    expect(result.items[1]).toEqual({ planId: 'project:proj-1', planName: 'Client Project', totalGross: 150 });
    expect(result.items[2]).toEqual({ planId: 'UNKNOWN', planName: 'Unknown', totalGross: 50 });
  });

  it('getByCountry returns buyer country breakdown', async () => {
    const from = new Date('2025-01-01');
    const to = new Date('2025-01-31');

    invoicesRepository.sumByBuyerCountryInPeriod.mockResolvedValue([
      { countryCode: 'DE', totalGross: 150 },
      { countryCode: 'UNKNOWN', totalGross: 50 },
    ]);

    const result = await service.getByCountry({ from, to });

    expect(result.totalGross).toBe(200);
    expect(result.items[0]).toEqual({ countryCode: 'DE', countryName: 'Germany', totalGross: 150 });
    expect(result.items[1]).toEqual({ countryCode: 'UNKNOWN', countryName: 'Unknown', totalGross: 50 });
  });
});
