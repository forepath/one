import { CustomerTrustScoreService } from './customer-trust-score.service';
import { TrustScoreProviderRegistry } from './trust-score-provider.registry';
import { CustomerTrustLevel } from './trust-score.types';

describe('CustomerTrustScoreService', () => {
  const customerProfilesRepository = {
    findByIdOrThrow: jest.fn(),
    findByUserId: jest.fn(),
    update: jest.fn(),
  };
  const billingNotificationPublisher = {
    publish: jest.fn(),
  };
  let registry: TrustScoreProviderRegistry;
  let service: CustomerTrustScoreService;

  beforeEach(() => {
    jest.resetAllMocks();
    registry = new TrustScoreProviderRegistry();
    service = new CustomerTrustScoreService(
      customerProfilesRepository as never,
      registry,
      billingNotificationPublisher as never,
    );
  });

  it('recomputes and persists a trust snapshot', async () => {
    registry.register({
      id: 'provider-a',
      evaluate: jest.fn().mockResolvedValue([
        {
          id: 'profile_complete',
          label: 'Complete profile',
          description: 'desc',
          points: 10,
          source: 'provider-a',
        },
        {
          id: 'failed_payments',
          label: 'Failed payments',
          description: 'desc',
          points: -20,
          source: 'provider-a',
        },
      ]),
    });
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      trustLevel: CustomerTrustLevel.YELLOW,
    });
    customerProfilesRepository.update.mockImplementation(async (_id: string, dto: Record<string, unknown>) => ({
      id: 'profile-1',
      userId: 'user-1',
      ...dto,
    }));

    const result = await service.recomputeForProfileId('profile-1');

    expect(result.score).toBe(90);
    expect(result.level).toBe(CustomerTrustLevel.YELLOW);
    expect(result.factors[0]).toEqual(expect.objectContaining({ id: 'base_score', points: 100 }));
    expect(customerProfilesRepository.update).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        trustScore: 90,
        trustLevel: CustomerTrustLevel.YELLOW,
        trustScoreUpdatedAt: expect.any(Date),
      }),
    );
    expect(billingNotificationPublisher.publish).not.toHaveBeenCalled();
  });

  it('returns detail from a fresh snapshot without persisting again', async () => {
    const computedAt = new Date();

    registry.register({
      id: 'provider-a',
      evaluate: jest.fn().mockResolvedValue([
        {
          id: 'profile_complete',
          label: 'Complete profile',
          description: 'desc',
          points: 10,
          source: 'provider-a',
        },
      ]),
    });
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      trustScore: 110,
      trustLevel: CustomerTrustLevel.YELLOW,
      trustScoreUpdatedAt: computedAt,
    });

    const result = await service.getSummaryForProfileId('profile-1');

    expect(result.score).toBe(110);
    expect(result.level).toBe(CustomerTrustLevel.YELLOW);
    expect(result.computedAt).toBe(computedAt);
    expect(customerProfilesRepository.update).not.toHaveBeenCalled();
    expect(billingNotificationPublisher.publish).not.toHaveBeenCalled();
  });

  it('publishes a level change when recomputation crosses a threshold', async () => {
    registry.register({
      id: 'provider-a',
      evaluate: jest.fn().mockResolvedValue([
        {
          id: 'active_or_past_subscription',
          label: 'Subscription history',
          description: 'desc',
          points: 25,
          source: 'provider-a',
        },
      ]),
    });
    customerProfilesRepository.findByUserId.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      trustLevel: CustomerTrustLevel.RED,
    });
    customerProfilesRepository.update.mockImplementation(async (_id: string, dto: Record<string, unknown>) => ({
      id: 'profile-1',
      userId: 'user-1',
      ...dto,
    }));

    const result = await service.recomputeForUser('user-1');

    expect(result?.score).toBe(125);
    expect(result?.level).toBe(CustomerTrustLevel.GREEN);
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'customer_trust.level_changed',
      expect.objectContaining({
        userId: 'user-1',
        profileId: 'profile-1',
        previousLevel: CustomerTrustLevel.RED,
        level: CustomerTrustLevel.GREEN,
        score: 125,
      }),
      'user-1',
    );
  });

  it('returns null when no billing profile exists for the user', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue(null);

    await expect(service.recomputeForUser('user-1')).resolves.toBeNull();
  });
});
