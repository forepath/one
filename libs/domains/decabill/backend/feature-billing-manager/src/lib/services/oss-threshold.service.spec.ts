import { OssThresholdService } from './oss-threshold.service';

describe('OssThresholdService', () => {
  const ledgersRepository = {
    findOrCreate: jest.fn(),
    save: jest.fn(),
    adjustTotal: jest.fn(),
    markThresholdExceeded: jest.fn(),
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

  it('records net atomically and publishes once when crossing the threshold', async () => {
    ledgersRepository.adjustTotal.mockResolvedValue({
      previous: 9500,
      next: 10100,
      thresholdEur: 10_000,
      thresholdExceededAt: null,
    });
    ledgersRepository.markThresholdExceeded.mockResolvedValue(true);

    const decision = await service.recordCrossBorderB2cNet({
      netAmount: 600,
      at: new Date('2026-07-01T00:00:00Z'),
    });

    expect(ledgersRepository.adjustTotal).toHaveBeenCalledWith(expect.any(String), 2026, 600);
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

  it('does not re-publish when another issuance already marked the threshold', async () => {
    ledgersRepository.adjustTotal.mockResolvedValue({
      previous: 9900,
      next: 10100,
      thresholdEur: 10_000,
      thresholdExceededAt: null,
    });
    ledgersRepository.markThresholdExceeded.mockResolvedValue(false);

    await service.recordCrossBorderB2cNet({ netAmount: 200, at: new Date('2026-07-01T00:00:00Z') });

    expect(notifications.publish).not.toHaveBeenCalled();
  });

  it('does not re-publish when already exceeded', async () => {
    ledgersRepository.adjustTotal.mockResolvedValue({
      previous: 12_000,
      next: 12_100,
      thresholdEur: 10_000,
      thresholdExceededAt: new Date('2026-03-01T00:00:00Z'),
    });

    await service.recordCrossBorderB2cNet({ netAmount: 100, at: new Date('2026-07-01T00:00:00Z') });

    expect(notifications.publish).not.toHaveBeenCalled();
    expect(ledgersRepository.markThresholdExceeded).not.toHaveBeenCalled();
  });

  it('takes voided / credited cross-border sales back out of the year total', async () => {
    ledgersRepository.adjustTotal.mockResolvedValue({
      previous: 500,
      next: 400,
      thresholdEur: 10_000,
      thresholdExceededAt: null,
    });

    await service.reverseCrossBorderB2cNet({ netAmount: 100, at: new Date('2026-07-01T00:00:00Z') });

    expect(ledgersRepository.adjustTotal).toHaveBeenCalledWith(expect.any(String), 2026, -100);
  });
});
