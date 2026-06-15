import { Injectable, Logger } from '@nestjs/common';

import { ReservedHostnamesRepository } from '../repositories/reserved-hostnames.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { generateHostnameCandidate } from '../utils/hostname-generator.utils';

const MAX_ATTEMPTS = 50;

/**
 * Reserves a unique hostname for a subscription item (e.g. for DNS and SSL).
 * Iterates until a free hostname is found, then registers it in the database.
 * Release on deprovision to allow reuse.
 */
@Injectable()
export class HostnameReservationService {
  private readonly logger = new Logger(HostnameReservationService.name);

  constructor(
    private readonly reservedHostnamesRepository: ReservedHostnamesRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
  ) {}

  /**
   * Reserves a unique hostname for the given subscription item.
   * Generates candidates (DigitalOcean-style) until one is not already taken, then persists it.
   * Also updates the subscription item's hostname column.
   * @returns The reserved hostname (single-level subdomain, no dots)
   * @throws If no free hostname found within MAX_ATTEMPTS
   */
  async reserveHostname(subscriptionItemId: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = generateHostnameCandidate();
      const exists = await this.reservedHostnamesRepository.existsByHostname(candidate);

      if (exists) {
        continue;
      }

      try {
        await this.reservedHostnamesRepository.create(candidate, subscriptionItemId);
        await this.subscriptionItemsRepository.updateHostname(subscriptionItemId, candidate);
        this.logger.log(`Reserved hostname ${candidate} for subscription item ${subscriptionItemId}`);

        return candidate;
      } catch (error) {
        if (await this.reservedHostnamesRepository.existsByHostname(candidate)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Could not reserve a unique hostname after ${MAX_ATTEMPTS} attempts`);
  }

  /**
   * Releases the hostname for the given subscription item (e.g. on deprovision).
   * Removes the row from reserved_hostnames and clears the item's hostname.
   */
  async releaseHostname(subscriptionItemId: string): Promise<void> {
    const reserved = await this.reservedHostnamesRepository.findBySubscriptionItemId(subscriptionItemId);

    if (reserved) {
      await this.reservedHostnamesRepository.deleteBySubscriptionItemId(subscriptionItemId);
      await this.subscriptionItemsRepository.updateHostname(subscriptionItemId, null);
      this.logger.log(`Released hostname ${reserved.hostname} for subscription item ${subscriptionItemId}`);
    }
  }
}
