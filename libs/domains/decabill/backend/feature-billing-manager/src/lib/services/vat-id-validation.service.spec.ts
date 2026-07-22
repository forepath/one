import { VatIdValidationSource, VatIdValidationStatus } from '../constants/vat-id-validation.constants';

import { VatIdValidationService } from './vat-id-validation.service';

describe('VatIdValidationService', () => {
  const notifications = { publish: jest.fn() };
  const enqueuePort = { enqueueUnit: jest.fn().mockResolvedValue(undefined) };
  let service: VatIdValidationService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    service = new VatIdValidationService(notifications as never, enqueuePort);
  });

  it('returns none when VAT ID is empty', async () => {
    await expect(service.validateOnProfileChange({ profileId: 'p1', userId: 'u1', vatId: '  ' })).resolves.toEqual({
      status: VatIdValidationStatus.NONE,
      source: null,
      validatedAt: null,
      vatId: null,
    });
  });

  it('marks invalid on format failure without calling VIES', async () => {
    const result = await service.validateOnProfileChange({
      profileId: 'p1',
      userId: 'u1',
      vatId: 'XX123',
    });

    expect(result.status).toBe(VatIdValidationStatus.INVALID);
    expect(result.source).toBe(VatIdValidationSource.FORMAT_ONLY);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notifications.publish).toHaveBeenCalledWith(
      'vat_id.validation_failed',
      expect.objectContaining({ profileId: 'p1' }),
      'u1',
    );
  });

  it('returns unavailable when VIES capability probe fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await service.validateOnProfileChange({
      profileId: 'p1',
      userId: 'u1',
      vatId: 'DE136695976',
    });

    expect(result.status).toBe(VatIdValidationStatus.UNAVAILABLE);
    expect(result.source).toBe(VatIdValidationSource.FORMAT_ONLY);
    expect(notifications.publish).toHaveBeenCalledWith(
      'vat_id.validation_unavailable',
      expect.objectContaining({ status: VatIdValidationStatus.UNAVAILABLE }),
      'u1',
    );
  });

  it('validates synchronously when VIES responds', async () => {
    fetchMock.mockResolvedValueOnce({ status: 200 }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true }),
    });

    await service.probeCapability();
    const result = await service.validateOnProfileChange({
      profileId: 'p1',
      userId: 'u1',
      vatId: 'DE136695976',
    });

    expect(result.status).toBe(VatIdValidationStatus.VALID);
    expect(result.source).toBe(VatIdValidationSource.VIES_SYNC);
    expect(notifications.publish).toHaveBeenCalledWith('vat_id.validation_succeeded', expect.any(Object), 'u1');
  });

  it('queues async validation on transient VIES failure while available', async () => {
    fetchMock.mockResolvedValueOnce({ status: 200 }).mockRejectedValueOnce(new Error('timeout'));

    await service.probeCapability();
    const result = await service.validateOnProfileChange({
      profileId: 'p1',
      userId: 'u1',
      vatId: 'DE136695976',
    });

    expect(result.status).toBe(VatIdValidationStatus.PENDING);
    expect(enqueuePort.enqueueUnit).toHaveBeenCalled();
    expect(notifications.publish).toHaveBeenCalledWith('vat_id.validation_pending', expect.any(Object), 'u1');
  });

  it('markValidatedByAdmin returns valid with admin source', () => {
    const result = service.markValidatedByAdmin('DE136695976');

    expect(result.status).toBe(VatIdValidationStatus.VALID);
    expect(result.source).toBe(VatIdValidationSource.ADMIN);
    expect(result.vatId).toBe('DE136695976');
  });
});
