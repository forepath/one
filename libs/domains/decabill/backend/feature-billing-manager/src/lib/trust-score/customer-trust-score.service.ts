import { Injectable, Logger } from '@nestjs/common';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';

import {
  CUSTOMER_TRUST_SCORE_BASE,
  CUSTOMER_TRUST_SCORE_MAX,
  CUSTOMER_TRUST_SCORE_MIN,
  CUSTOMER_TRUST_SCORE_SNAPSHOT_TTL_MS,
  CUSTOMER_TRUST_SCORE_THRESHOLDS,
} from './trust-score.constants';
import { TrustScoreProviderRegistry } from './trust-score-provider.registry';
import { CustomerTrustLevel, type CustomerTrustScoreSummary } from './trust-score.types';

@Injectable()
export class CustomerTrustScoreService {
  private readonly logger = new Logger(CustomerTrustScoreService.name);

  constructor(
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly trustScoreProviderRegistry: TrustScoreProviderRegistry,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
  ) {}

  isSnapshotFresh(profile: Pick<CustomerProfileEntity, 'trustScore' | 'trustLevel' | 'trustScoreUpdatedAt'>): boolean {
    if (profile.trustScore == null || !profile.trustLevel || !profile.trustScoreUpdatedAt) {
      return false;
    }

    return Date.now() - profile.trustScoreUpdatedAt.getTime() <= CUSTOMER_TRUST_SCORE_SNAPSHOT_TTL_MS;
  }

  async ensureFreshSnapshot(profile: CustomerProfileEntity): Promise<CustomerProfileEntity> {
    if (this.isSnapshotFresh(profile)) {
      return profile;
    }

    try {
      const result = await this.recomputeProfile(profile);

      return result.profile;
    } catch (error) {
      this.logger.error(`Failed to refresh trust score for profile ${profile.id}`, error);

      return profile;
    }
  }

  async recomputeForProfileId(profileId: string): Promise<CustomerTrustScoreSummary> {
    const profile = await this.customerProfilesRepository.findByIdOrThrow(profileId);
    const result = await this.recomputeProfile(profile);

    return result.summary;
  }

  async getSummaryForProfileId(profileId: string): Promise<CustomerTrustScoreSummary> {
    const profile = await this.customerProfilesRepository.findByIdOrThrow(profileId);

    if (!this.isSnapshotFresh(profile)) {
      return await this.recomputeForProfileId(profileId);
    }

    return await this.summarizeProfile(profile);
  }

  async recomputeForUser(userId: string): Promise<CustomerTrustScoreSummary | null> {
    const profile = await this.customerProfilesRepository.findByUserId(userId);

    if (!profile) {
      return null;
    }

    const result = await this.recomputeProfile(profile);

    return result.summary;
  }

  triggerRecomputeForUser(userId: string): void {
    void this.recomputeForUser(userId).catch((error: unknown) => {
      this.logger.error(`Failed to recompute trust score for user ${userId}`, error);
    });
  }

  private async recomputeProfile(
    profile: CustomerProfileEntity,
  ): Promise<{ profile: CustomerProfileEntity; summary: CustomerTrustScoreSummary }> {
    const factors = await this.evaluateFactors(profile.userId);
    const score = this.clampScore(
      CUSTOMER_TRUST_SCORE_BASE + factors.reduce((total, factor) => total + factor.points, 0),
    );
    const level = this.resolveLevel(score);
    const computedAt = new Date();
    const updatedProfile = await this.customerProfilesRepository.update(profile.id, {
      trustScore: score,
      trustLevel: level,
      trustScoreUpdatedAt: computedAt,
    });

    if (profile.trustLevel && profile.trustLevel !== level) {
      this.billingNotificationPublisher.publish(
        'customer_trust.level_changed',
        {
          userId: profile.userId,
          profileId: profile.id,
          previousLevel: profile.trustLevel,
          level,
          score,
        },
        profile.userId,
      );
    }

    return {
      profile: updatedProfile,
      summary: this.buildSummary(score, level, computedAt, factors),
    };
  }

  private async summarizeProfile(profile: CustomerProfileEntity): Promise<CustomerTrustScoreSummary> {
    const factors = await this.evaluateFactors(profile.userId);

    return this.buildSummary(profile.trustScore!, profile.trustLevel!, profile.trustScoreUpdatedAt!, factors);
  }

  private async evaluateFactors(userId: string): Promise<CustomerTrustScoreSummary['factors']> {
    return (
      await Promise.all(this.trustScoreProviderRegistry.getProviders().map((provider) => provider.evaluate(userId)))
    ).flat();
  }

  private buildSummary(
    score: number,
    level: CustomerTrustLevel,
    computedAt: Date,
    factors: CustomerTrustScoreSummary['factors'],
  ): CustomerTrustScoreSummary {
    return {
      score,
      level,
      baseScore: CUSTOMER_TRUST_SCORE_BASE,
      factors: [
        {
          id: 'base_score',
          label: 'Base score',
          description: 'New accounts start from a neutral trust baseline before billing history is applied.',
          points: CUSTOMER_TRUST_SCORE_BASE,
          source: 'system',
        },
        ...factors,
      ],
      computedAt,
      sources: [...new Set(factors.map((factor) => factor.source))],
    };
  }

  private clampScore(score: number): number {
    return Math.max(CUSTOMER_TRUST_SCORE_MIN, Math.min(CUSTOMER_TRUST_SCORE_MAX, score));
  }

  private resolveLevel(score: number): CustomerTrustLevel {
    if (score >= CUSTOMER_TRUST_SCORE_THRESHOLDS[CustomerTrustLevel.GREEN]) {
      return CustomerTrustLevel.GREEN;
    }

    if (score >= CUSTOMER_TRUST_SCORE_THRESHOLDS[CustomerTrustLevel.YELLOW]) {
      return CustomerTrustLevel.YELLOW;
    }

    return CustomerTrustLevel.RED;
  }
}
