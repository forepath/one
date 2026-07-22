import { OssThresholdService } from './oss-threshold.service';

describe('OssThresholdService', () => {
  const ledgersRepository = {
    findOrCreate: jest.fn(),
    save: jest.fn(),
  };
  const notifications = {
    publish: jest.fn(),
  };

  const service = new OssThresholdService(ledgersRepository as never, notifications as never);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BILLING_OSS_REGISTERED;
    ledgersRepository.findOrCreate.mockResolvedValue({
      tenantId: 'unified',
      calendarYear: 2026,
      crossBorderB2cNetTotal: 0,
      thresholdEur: 10_000,
      thresholdExceededAt: null,
    });
    ledgersRepository.save.mockImplementation(async (row) => row);
  });

  it('forces destination VAT when BILLING_OSS_REGISTERED is true', async () => {
    process.env.BILLING_OSS_REGISTERED = 'true';

    await expect(service.getDecision()).resolves.toEqual(
      expect.objectContaining({
        ossDestinationApplies: true,
        registeredOverride: true,
        thresholdExceeded: true,
      }),
    );
    expect(ledgersRepository.findOrCreate).not.toHaveBeenCalled();
  });

  it('keeps home VAT while under threshold', async () => {
    ledgersRepository.findOrCreate.mockResolvedValue({
      tenantId: 'unified',
      calendarYear: 2026,
      crossBorderB2cNetTotal: 2500,
      thresholdEur: 10_000,
      thresholdExceededAt: null,
    });

    await expect(service.getDecision({ at: new Date('2026-06-01T00:00:00Z') })).resolves.toEqual(
      expect.objectContaining({
        ossDestinationApplies: false,
        crossBorderB2cNetTotal: 2500,
        thresholdExceeded: false,
        registeredOverride: false,
      }),
    );
  });

  it('records net and publishes when crossing the threshold', async () => {
    ledgersRepository.findOrCreate.mockResolvedValue({
      tenantId: 'unified',
      calendarYear: 2026,
      crossBorderB2cNetTotal: 9500,
      thresholdEur: 10_000,
      thresholdExceededAt: null,
    });

    const decision = await service.recordCrossBorderB2cNet({
      netAmount: 600,
      at: new Date('2026-07-01T00:00:00Z'),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        ossDestinationApplies: true,
        crossBorderB2cNetTotal: 10100,
        thresholdExceeded: true,
      }),
    );
    expect(notifications.publish).toHaveBeenCalledWith(
      'oss.threshold_exceeded',
      expect.objectContaining({
        calendarYear: 2026,
        crossBorderB2cNetTotal: 10100,
        thresholdEur: 10_000,
      }),
    );
  });

  it('does not re-publish when already exceeded', async () => {
    ledgersRepository.findOrCreate.mockResolvedValue({
      tenantId: 'unified',
      calendarYear: 2026,
      crossBorderB2cNetTotal: 12_000,
      thresholdEur: 10_000,
      thresholdExceededAt: new Date('2026-03-01T00:00:00Z'),
    });

    await service.recordCrossBorderB2cNet({ netAmount: 100, at: new Date('2026-07-01T00:00:00Z') });

    expect(notifications.publish).not.toHaveBeenCalled();
    expect(ledgersRepository.save).toHaveBeenCalled();
  });
});
