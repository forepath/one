import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import type { MeterCollectContext, MeterCollectSample } from '../../dto/meter-collect.types';
import { AddonsRepository } from '../../repositories/addons.repository';
import { LOADWEAVER_USAGE_TIMEOUT_MS } from './loadweaver-usage.constants';
import {
  loadweaverUsageSamples,
  loadweaverUsageWindow,
  resolveLoadweaverUsageConnection,
  type LoadweaverUsageReport,
} from './loadweaver-usage.utils';

const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 1_000;

/**
 * Pulls the hourly usage buckets of the Loadweaver projects mapped to a subscription (`spec.billing` in Loadweaver)
 * for the meter-collect job. One HTTP call per subscription and window: the job asks once per due meter with the
 * same window, so answers are cached for a minute.
 */
@Injectable()
export class LoadweaverUsageCollectService {
  private readonly logger = new Logger(LoadweaverUsageCollectService.name);
  private readonly cache = new Map<string, { at: number; report: Promise<LoadweaverUsageReport> }>();

  constructor(private readonly addonsRepository: AddonsRepository) {}

  async collect(ctx: MeterCollectContext): Promise<MeterCollectSample[]> {
    if (!ctx.addonId) {
      return [];
    }

    const addon = await this.addonsRepository.findByIdOrThrow(ctx.addonId);
    const connection = resolveLoadweaverUsageConnection(addon.configDefaultValues);
    const window = loadweaverUsageWindow(ctx.periodStart, ctx.periodEnd);
    const report = await this.report(connection, ctx.addonId, ctx.subscriptionId, window.from, window.to);

    if (report.truncated) {
      // Recording a partial window would lose the rest (the next window starts at its end): retry instead.
      throw new Error(`Loadweaver usage answer for subscription ${ctx.subscriptionId} is truncated`);
    }

    return ctx.meterKeys.flatMap((meterKey) =>
      loadweaverUsageSamples({
        report,
        meterKey,
        subscriptionId: ctx.subscriptionId,
        periodStart: ctx.periodStart,
        periodEnd: ctx.periodEnd,
      }),
    );
  }

  private async report(
    connection: { url: string; token: string },
    addonId: string,
    subscriptionId: string,
    from: Date,
    to: Date,
  ): Promise<LoadweaverUsageReport> {
    const key = `${addonId}|${subscriptionId}|${from.toISOString()}|${to.toISOString()}`;
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && now - cached.at < CACHE_MS) {
      return await cached.report;
    }

    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      for (const [k, v] of this.cache) if (now - v.at >= CACHE_MS) this.cache.delete(k);

      if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    }

    const report = this.fetch(connection, subscriptionId, from, to);

    this.cache.set(key, { at: now, report });
    report.catch(() => this.cache.delete(key));

    return await report;
  }

  private async fetch(
    connection: { url: string; token: string },
    subscriptionId: string,
    from: Date,
    to: Date,
  ): Promise<LoadweaverUsageReport> {
    const response = await axios.get<LoadweaverUsageReport>(`${connection.url}/usage`, {
      params: {
        billingSubscription: subscriptionId,
        granularity: 'hour',
        finalOnly: 'true',
        from: from.toISOString(),
        to: to.toISOString(),
      },
      headers: { Authorization: `Bearer ${connection.token}`, Accept: 'application/json' },
      timeout: LOADWEAVER_USAGE_TIMEOUT_MS,
      maxContentLength: 32 * 1024 * 1024,
      maxRedirects: 0,
    });
    const data = response.data;

    if (!data || typeof data.cluster !== 'string' || !Array.isArray(data.rows)) {
      this.logger.warn(`Unexpected Loadweaver usage answer for subscription ${subscriptionId}`);
      throw new Error('Unexpected Loadweaver usage answer');
    }

    return { cluster: data.cluster, rows: data.rows, truncated: data.truncated === true };
  }
}
