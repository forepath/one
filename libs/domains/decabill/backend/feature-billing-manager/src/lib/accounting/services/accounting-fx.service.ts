import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';

import { child, children, parseXml, attributeOf } from '../bank-import/parsers/safe-xml';
import { AccountingFxRateEntity } from '../entities/accounting-fx-rate.entity';
import { addDays } from '../utils/accounting-date.util';

import { AccountingConfigService } from './accounting-config.service';

const MAX_FEED_BYTES = 256 * 1024;
const MAX_RATE_AGE_DAYS = 14;

export interface FxConversion {
  /** Units of document currency per 1 functional currency. */
  rate: number;
  functionalAmount: number;
  rateDate: string;
  source: 'ecb' | 'manual' | 'identity';
}

/**
 * Exchange rates. ECB euro reference rates are fetched by a scheduled job; manual rates override them for the same
 * date. Conversions use the latest rate on or before the booking date (max. 14 days old).
 */
@Injectable()
export class AccountingFxService {
  private readonly logger = new Logger(AccountingFxService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AccountingConfigService,
  ) {}

  async convert(amount: number, currency: string, date: string, manager?: EntityManager): Promise<FxConversion> {
    const functional = this.config.getConfig().functionalCurrency;
    const cur = currency.toUpperCase();

    if (cur === functional) {
      return { rate: 1, functionalAmount: amount, rateDate: date, source: 'identity' };
    }

    const rate = await this.getRate(cur, date, manager);

    return {
      rate: rate.rate,
      functionalAmount: Math.round((amount / rate.rate) * 100) / 100,
      rateDate: rate.rateDate,
      source: rate.source,
    };
  }

  /** Rate as units of `currency` per 1 functional currency (cross rate over EUR when the functional currency isn't EUR). */
  async getRate(
    currency: string,
    date: string,
    manager?: EntityManager,
  ): Promise<{ rate: number; rateDate: string; source: 'ecb' | 'manual' }> {
    const functional = this.config.getConfig().functionalCurrency;
    const perEur = await this.lookupPerEur(currency, date, manager);

    if (functional === 'EUR') {
      return perEur;
    }

    const functionalPerEur = await this.lookupPerEur(functional, date, manager);

    return {
      rate: Math.round((perEur.rate / functionalPerEur.rate) * 1e8) / 1e8,
      rateDate: perEur.rateDate < functionalPerEur.rateDate ? perEur.rateDate : functionalPerEur.rateDate,
      source: perEur.source === 'manual' || functionalPerEur.source === 'manual' ? 'manual' : 'ecb',
    };
  }

  async listRates(params: { currency?: string; from?: string; to?: string; limit: number; offset: number }) {
    const qb = this.dataSource
      .getRepository(AccountingFxRateEntity)
      .createQueryBuilder('r')
      .orderBy('r.rateDate', 'DESC')
      .addOrderBy('r.currency', 'ASC')
      .take(params.limit)
      .skip(params.offset);

    if (params.currency) {
      qb.andWhere('r.currency = :currency', { currency: params.currency.toUpperCase() });
    }

    if (params.from) {
      qb.andWhere('r.rate_date >= :from', { from: params.from });
    }

    if (params.to) {
      qb.andWhere('r.rate_date <= :to', { to: params.to });
    }

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }

  /** Manual rate (units of `currency` per 1 EUR), overriding the ECB rate of that date. */
  async setManualRate(
    currency: string,
    rateDate: string,
    rate: number,
    userId: string | null,
  ): Promise<AccountingFxRateEntity> {
    const cur = currency.toUpperCase();

    if (!/^[A-Z]{3}$/.test(cur) || cur === 'EUR') {
      throw new BadRequestException('Currency must be a 3-letter ISO code other than EUR');
    }

    if (!Number.isFinite(rate) || rate <= 0 || rate > 1e7) {
      throw new BadRequestException('Rate must be a positive number');
    }

    await this.dataSource.query(
      `INSERT INTO billing_accounting_fx_rates (currency, rate_date, rate, source, created_by_user_id)
       VALUES ($1, $2, $3, 'manual', $4)
       ON CONFLICT (currency, rate_date, source) DO UPDATE SET rate = EXCLUDED.rate, created_by_user_id = EXCLUDED.created_by_user_id`,
      [cur, rateDate, rate, userId],
    );

    return (await this.dataSource
      .getRepository(AccountingFxRateEntity)
      .findOne({ where: { currency: cur, rateDate, source: 'manual' } }))!;
  }

  /** Fetches the ECB daily reference rates feed and stores them. Returns the number of rates stored. */
  async fetchEcbRates(): Promise<number> {
    const { ecbRatesUrl, fxSource } = this.config.getConfig();

    if (fxSource !== 'ecb') {
      return 0;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(ecbRatesUrl, { signal: controller.signal, redirect: 'error' });

      if (!response.ok) {
        throw new Error(`ECB feed returned HTTP ${response.status}`);
      }

      const declared = Number(response.headers.get('content-length') ?? 0);

      if (declared > MAX_FEED_BYTES) {
        throw new Error('ECB feed too large');
      }

      const body = Buffer.from(await response.arrayBuffer());

      if (body.length > MAX_FEED_BYTES) {
        throw new Error('ECB feed too large');
      }

      const rates = this.parseEcbFeed(body.toString('utf8'));

      for (const r of rates) {
        await this.dataSource.query(
          `INSERT INTO billing_accounting_fx_rates (currency, rate_date, rate, source) VALUES ($1, $2, $3, 'ecb')
           ON CONFLICT (currency, rate_date, source) DO UPDATE SET rate = EXCLUDED.rate`,
          [r.currency, r.date, r.rate],
        );
      }

      return rates.length;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Parses `gesmes:Envelope/Cube/Cube[@time]/Cube[@currency,@rate]` (ECB eurofxref format). */
  parseEcbFeed(xml: string): Array<{ currency: string; date: string; rate: number }> {
    const root = parseXml(xml);
    const outer = child(root, 'Cube');
    const out: Array<{ currency: string; date: string; rate: number }> = [];

    for (const day of children(outer, 'Cube')) {
      const date = attributeOf(day, 'time');

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        continue;
      }

      for (const entry of children(day, 'Cube')) {
        const currency = attributeOf(entry, 'currency')?.toUpperCase();
        const rate = Number(attributeOf(entry, 'rate'));

        if (currency && /^[A-Z]{3}$/.test(currency) && Number.isFinite(rate) && rate > 0) {
          out.push({ currency, date, rate });
        }
      }
    }

    return out;
  }

  private async lookupPerEur(
    currency: string,
    date: string,
    manager?: EntityManager,
  ): Promise<{ rate: number; rateDate: string; source: 'ecb' | 'manual' }> {
    if (currency === 'EUR') {
      return { rate: 1, rateDate: date, source: 'ecb' };
    }

    const repo = (manager ?? this.dataSource.manager).getRepository(AccountingFxRateEntity);
    const candidates = await repo.find({
      where: { currency, rateDate: LessThanOrEqual(date) },
      order: { rateDate: 'DESC' },
      take: 4,
    });
    const latestDate = candidates[0]?.rateDate;

    if (!latestDate || latestDate < addDays(date, -MAX_RATE_AGE_DAYS)) {
      throw new BadRequestException(`No exchange rate for ${currency} on or before ${date}`);
    }

    const sameDay = candidates.filter((c) => c.rateDate === latestDate);
    const chosen = sameDay.find((c) => c.source === 'manual') ?? sameDay[0];

    return { rate: Number(chosen.rate), rateDate: chosen.rateDate, source: chosen.source };
  }
}
