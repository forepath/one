import { HostnameReservationService } from './hostname-reservation.service';

describe('HostnameReservationService', () => {
  const subscriptionItemId = '11111111-1111-4111-8111-111111111111';

  it('reserves a hostname and releases it', async () => {
    const reservedHostnamesRepository = {
      existsByHostname: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockImplementation(async (hostname: string, subId: string) => ({
        id: 'res-id',
        hostname,
        subscriptionItemId: subId,
      })),
      deleteBySubscriptionItemId: jest.fn().mockResolvedValue(undefined),
      findBySubscriptionItemId: jest
        .fn()
        .mockResolvedValueOnce({ hostname: 'awesome-armadillo-abc12' })
        .mockResolvedValueOnce(null),
    };
    const subscriptionItemsRepository = {
      updateHostname: jest.fn().mockResolvedValue({}),
    };
    const service = new HostnameReservationService(
      reservedHostnamesRepository as never,
      subscriptionItemsRepository as never,
    );
    const hostname = await service.reserveHostname(subscriptionItemId);

    expect(hostname).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]+$/);
    expect(reservedHostnamesRepository.create).toHaveBeenCalledWith(hostname, subscriptionItemId);
    expect(subscriptionItemsRepository.updateHostname).toHaveBeenCalledWith(subscriptionItemId, hostname);

    await service.releaseHostname(subscriptionItemId);
    expect(reservedHostnamesRepository.deleteBySubscriptionItemId).toHaveBeenCalledWith(subscriptionItemId);
    expect(subscriptionItemsRepository.updateHostname).toHaveBeenLastCalledWith(subscriptionItemId, null);
  });

  it('iterates until a free hostname is found', async () => {
    const reservedHostnamesRepository = {
      existsByHostname: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      create: jest.fn().mockImplementation(async (hostname: string, subId: string) => ({
        id: 'res-id',
        hostname,
        subscriptionItemId: subId,
      })),
      deleteBySubscriptionItemId: jest.fn(),
      findBySubscriptionItemId: jest.fn().mockResolvedValue(null),
    };
    const subscriptionItemsRepository = {
      updateHostname: jest.fn().mockResolvedValue({}),
    };
    const service = new HostnameReservationService(
      reservedHostnamesRepository as never,
      subscriptionItemsRepository as never,
    );
    const hostname = await service.reserveHostname(subscriptionItemId);

    expect(hostname).toBeDefined();
    expect(reservedHostnamesRepository.existsByHostname).toHaveBeenCalledTimes(3);
    expect(reservedHostnamesRepository.create).toHaveBeenCalledTimes(1);
  });

  it('throws when no free hostname found within max attempts', async () => {
    const reservedHostnamesRepository = {
      existsByHostname: jest.fn().mockResolvedValue(true),
      create: jest.fn(),
      deleteBySubscriptionItemId: jest.fn(),
      findBySubscriptionItemId: jest.fn().mockResolvedValue(null),
    };
    const subscriptionItemsRepository = {
      updateHostname: jest.fn(),
    };
    const service = new HostnameReservationService(
      reservedHostnamesRepository as never,
      subscriptionItemsRepository as never,
    );

    await expect(service.reserveHostname(subscriptionItemId)).rejects.toThrow(/Could not reserve a unique hostname/);
  });

  it('releaseHostname does nothing when no reservation exists', async () => {
    const reservedHostnamesRepository = {
      existsByHostname: jest.fn(),
      create: jest.fn(),
      deleteBySubscriptionItemId: jest.fn(),
      findBySubscriptionItemId: jest.fn().mockResolvedValue(null),
    };
    const subscriptionItemsRepository = {
      updateHostname: jest.fn(),
    };
    const service = new HostnameReservationService(
      reservedHostnamesRepository as never,
      subscriptionItemsRepository as never,
    );

    await service.releaseHostname(subscriptionItemId);
    expect(reservedHostnamesRepository.deleteBySubscriptionItemId).not.toHaveBeenCalled();
    expect(subscriptionItemsRepository.updateHostname).not.toHaveBeenCalled();
  });
});
