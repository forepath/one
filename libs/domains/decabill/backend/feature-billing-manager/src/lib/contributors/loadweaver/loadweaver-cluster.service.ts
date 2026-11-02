import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { SubscriptionStatus } from '../../entities/subscription.entity';
import { SubscriptionItemsRepository } from '../../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../../repositories/subscriptions.repository';

import type { LoadweaverAdminClaimStatus, LoadweaverClusterInfoResponseDto } from './loadweaver-cluster.dto';
import {
  LOADWEAVER_ADMIN_CLAIMED_AT_KEY,
  LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY,
  LOADWEAVER_ADMIN_CLAIM_TOKEN_PATTERN,
  isLoadweaverItem,
  loadweaverTeardownNotBefore,
  mapLoadweaverClusterHealth,
  resolveLoadweaverTeardownGraceDays,
  type LoadweaverProbeResult,
} from './loadweaver.utils';

const PROBE_TIMEOUT_MS = 5_000;
const HOST_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const BASE_DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type LoadweaverProbe = (url: string) => Promise<LoadweaverProbeResult>;

/** Unauthenticated GET without redirects, short timeout; the URL is built from the reserved host name only. */
export const fetchLoadweaverProbe: LoadweaverProbe = async (url) => {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });

    if (url.endsWith('/api/health')) {
      const body = res.ok ? ((await res.json().catch(() => null)) as { status?: unknown } | null) : null;

      return { ok: res.ok && body?.status === 'ok', status: res.status };
    }

    if (url.endsWith('/api/install/claim-status')) {
      const body = res.ok
        ? ((await res.json().catch(() => null)) as { claimRequired?: unknown; claimConfigured?: unknown } | null)
        : null;
      const claimRequired = typeof body?.claimRequired === 'boolean' ? body.claimRequired : undefined;
      const claimConfigured = typeof body?.claimConfigured === 'boolean' ? body.claimConfigured : undefined;

      return {
        ok: res.ok && claimRequired !== undefined,
        status: res.status,
        claimRequired,
        ...(claimConfigured !== undefined ? { claimConfigured } : {}),
      };
    }

    return { ok: res.status < 400, status: res.status };
  } catch {
    return { ok: false };
  }
};

/**
 * Status of a Decabill-provisioned Loadweaver cluster for the billing console: endpoint, health of control plane and
 * console (public probes, no credentials: Decabill holds none for the customer's cluster), deep links for the
 * pre-cancellation steps and the teardown schedule.
 */
@Injectable()
export class LoadweaverClusterService {
  private readonly logger = new Logger(LoadweaverClusterService.name);
  private probe: LoadweaverProbe = fetchLoadweaverProbe;

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
  ) {}

  /** Tests replace the network probe. */
  useProbe(probe: LoadweaverProbe): void {
    this.probe = probe;
  }

  async getClusterInfo(
    subscriptionId: string,
    itemId: string,
    options: { userId?: string; asAdmin?: boolean },
  ): Promise<LoadweaverClusterInfoResponseDto> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (!options.asAdmin && (!options.userId || subscription.userId !== options.userId)) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!item || !isLoadweaverItem(item)) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    const origin = this.origin(item.hostname);
    const hasProviderReference = !!item.providerReference?.trim();
    const probing = origin && item.provisioningStatus === 'active' && hasProviderReference;
    const snapshot = item.configSnapshot ?? {};
    const storedToken = snapshot[LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY];
    const token =
      typeof storedToken === 'string' && LOADWEAVER_ADMIN_CLAIM_TOKEN_PATTERN.test(storedToken) ? storedToken : null;
    const alreadyClaimed = !!snapshot[LOADWEAVER_ADMIN_CLAIMED_AT_KEY];
    const [api, consoleProbe, claim] = probing
      ? await Promise.all([
          this.probe(`${origin}/api/health`),
          this.probe(`${origin}/`),
          alreadyClaimed ? Promise.resolve(undefined) : this.probe(`${origin}/api/install/claim-status`),
        ])
      : [undefined, undefined, undefined];
    const health = mapLoadweaverClusterHealth({
      provisioningStatus: item.provisioningStatus,
      hasProviderReference,
      provisionedAt: item.provisionedAt ?? null,
      api,
      console: consoleProbe,
    });

    if (probing && health === 'unreachable') {
      this.logger.warn(`Loadweaver cluster of item ${item.id} is unreachable (API ${api?.status ?? 'no response'})`);
    }

    let claimStatus: LoadweaverAdminClaimStatus = alreadyClaimed ? 'claimed' : 'unknown';

    if (!alreadyClaimed && api?.ok && claim?.ok) {
      // Only a cluster that has the claim configured and needs it no more is claimed. `claimRequired: false`
      // without `claimConfigured: true` (an older release, a member / restore missing the hash) proves nothing:
      // the token stays (shown) and the state unknown.
      if (claim.claimRequired) claimStatus = 'pending';
      else if (claim.claimConfigured === true) claimStatus = 'claimed';
    }

    if (claimStatus === 'claimed' && (token || !alreadyClaimed)) {
      // The first account exists: the token is useless now, so it is wiped from the (encrypted) item config.
      const rest = { ...snapshot };

      delete rest[LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY];

      await this.subscriptionItemsRepository.updateConfigSnapshot(item.id, {
        ...rest,
        [LOADWEAVER_ADMIN_CLAIMED_AT_KEY]: snapshot[LOADWEAVER_ADMIN_CLAIMED_AT_KEY] ?? new Date().toISOString(),
      });
      this.logger.log(`Loadweaver cluster of item ${item.id} reports its admin claim done; claim token wiped`);
    }

    const graceDays = resolveLoadweaverTeardownGraceDays();
    const storedTeardown = subscription.teardownNotBefore ? new Date(subscription.teardownNotBefore) : null;
    const deletionNotBefore =
      subscription.status === SubscriptionStatus.PENDING_CANCEL && subscription.cancelEffectiveAt
        ? (
            storedTeardown ?? loadweaverTeardownNotBefore(new Date(subscription.cancelEffectiveAt), graceDays)
          ).toISOString()
        : null;
    const version = item.configSnapshot?.['loadweaverVersion'];

    return {
      itemId: item.id,
      consoleUrl: origin,
      apiUrl: origin ? `${origin}/api` : null,
      installerUrl: origin ? `${origin}/api/install/install.sh` : null,
      health,
      checkedAt: new Date().toISOString(),
      initialVersion: typeof version === 'string' && version.trim() ? version.trim() : null,
      links: {
        platformBackups: origin ? `${origin}/backups/platform` : null,
        recoveryKit: origin ? `${origin}/backups/keys` : null,
        nodes: origin ? `${origin}/nodes` : null,
      },
      adminClaim: {
        status: claimStatus,
        // Customer only (never the admin view), and only until the claim is done.
        token: !options.asAdmin && claimStatus !== 'claimed' ? token : null,
      },
      teardown: { graceDays, deletionNotBefore },
    };
  }

  private origin(hostname: string | null | undefined): string | null {
    const label = hostname?.trim().toLowerCase();
    const baseDomain = (process.env.DNS_BASE_DOMAIN ?? 'spirde.com').trim().toLowerCase();

    if (!label || !HOST_LABEL_PATTERN.test(label) || !BASE_DOMAIN_PATTERN.test(baseDomain)) {
      return null;
    }

    return `https://${label}.${baseDomain}`;
  }
}
