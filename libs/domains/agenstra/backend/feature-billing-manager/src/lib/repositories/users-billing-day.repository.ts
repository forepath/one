import { UserEntity } from '@forepath/identity/backend';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { getEffectiveBillingDay } from '../utils/billing-day.utils';

/**
 * Billing-specific user queries. Uses UserEntity to find users by effective billing day
 * (COALESCE(billing_day_of_month, LEAST(28, EXTRACT(DAY FROM created_at)::int))).
 */
@Injectable()
export class UsersBillingDayRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}

  /**
   * Returns the effective billing day (1-28) for a user. Defaults to 1 if user not found.
   */
  async getEffectiveBillingDayForUser(userId: string): Promise<number> {
    const user = await this.repository.findOne({ where: { id: userId }, select: ['createdAt', 'billingDayOfMonth'] });

    if (!user?.createdAt) {
      return 1;
    }

    return getEffectiveBillingDay(user.createdAt, user.billingDayOfMonth ?? undefined);
  }

  /**
   * Returns user ids whose effective billing day equals the given day (1-28).
   */
  async findUserIdsWithBillingDay(dayOfMonth: number): Promise<string[]> {
    const rows = await this.repository
      .createQueryBuilder('u')
      .select('u.id', 'id')
      .where(`COALESCE(u.billing_day_of_month, LEAST(28, EXTRACT(DAY FROM u.created_at)::int)) = :day`, {
        day: dayOfMonth,
      })
      .getRawMany<{ id: string }>();

    return rows.map((r) => r.id);
  }
}
