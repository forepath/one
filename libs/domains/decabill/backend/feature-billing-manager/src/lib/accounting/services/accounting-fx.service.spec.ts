import { BadRequestException } from '@nestjs/common';

import { AccountingFxService } from './accounting-fx.service';

const ECB_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender>
    <gesmes:name>European Central Bank</gesmes:name>
  </gesmes:Sender>
  <Cube>
    <Cube time="2026-03-06">
      <Cube currency="USD" rate="1.0800"/>
      <Cube currency="JPY" rate="161.52"/>
      <Cube currency="gbp" rate="0.8412"/>
      <Cube currency="XX1" rate="2.0"/>
      <Cube currency="CHF" rate="abc"/>
      <Cube currency="SEK" rate="0"/>
    </Cube>
    <Cube time="2026-03-05">
      <Cube currency="USD" rate="1.0750"/>
    </Cube>
    <Cube time="06.03.2026">
      <Cube currency="NOK" rate="11.5"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

interface Rate {
  currency: string;
  rateDate: string;
  rate: string;
  source: 'ecb' | 'manual';
}

describe('AccountingFxService', () => {
  let rates: Rate[];
  const settings = {
    functionalCurrency: 'EUR',
    fxSource: 'ecb',
    ecbRatesUrl: 'https://ecb.example/eurofxref-daily.xml',
  };
  const repo = {
    find: jest.fn(async ({ where, take }: { where: { currency: string; rateDate: { value: string } }; take: number }) =>
      rates
        .filter((r) => r.currency === where.currency && r.rateDate <= where.rateDate.value)
        .sort((a, b) => b.rateDate.localeCompare(a.rateDate))
        .slice(0, take),
    ),
    findOne: jest.fn(
      async ({ where }: { where: Partial<Rate> }) =>
        rates.find(
          (r) => r.currency === where.currency && r.rateDate === where.rateDate && r.source === where.source,
        ) ?? null,
    ),
  };
  const dataSource = {
    manager: { getRepository: jest.fn(() => repo) },
    getRepository: jest.fn(() => repo),
    query: jest.fn(async (_sql: string, _params?: unknown[]) => []),
  };
  const config = { getConfig: jest.fn(() => settings) };
  const service = new AccountingFxService(dataSource as never, config as never);
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    settings.functionalCurrency = 'EUR';
    settings.fxSource = 'ecb';
    rates = [
      { currency: 'USD', rateDate: '2026-03-05', rate: '1.07500000', source: 'ecb' },
      // Friday before the weekend
      { currency: 'USD', rateDate: '2026-03-06', rate: '1.08000000', source: 'ecb' },
      { currency: 'CHF', rateDate: '2026-03-06', rate: '0.95000000', source: 'ecb' },
    ];
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('parseEcbFeed', () => {
    it('reads currency/rate pairs per day and skips malformed dates, codes and rates', () => {
      expect(service.parseEcbFeed(ECB_SAMPLE)).toEqual([
        { currency: 'USD', date: '2026-03-06', rate: 1.08 },
        { currency: 'JPY', date: '2026-03-06', rate: 161.52 },
        { currency: 'GBP', date: '2026-03-06', rate: 0.8412 },
        { currency: 'USD', date: '2026-03-05', rate: 1.075 },
      ]);
    });

    it('returns nothing for a feed without the cube structure', () => {
      expect(service.parseEcbFeed('<Envelope><subject>x</subject></Envelope>')).toEqual([]);
    });
  });

  describe('convert', () => {
    it('returns rate 1 for the functional currency (case-insensitive) without a lookup', async () => {
      await expect(service.convert(123.45, 'eur', '2026-03-08')).resolves.toEqual({
        rate: 1,
        functionalAmount: 123.45,
        rateDate: '2026-03-08',
        source: 'identity',
      });
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('uses the rate of the booking date', async () => {
      await expect(service.convert(107.5, 'usd', '2026-03-05')).resolves.toEqual({
        rate: 1.075,
        functionalAmount: 100,
        rateDate: '2026-03-05',
        source: 'ecb',
      });
    });

    it('falls back to the previous business day on weekends', async () => {
      // 2026-03-08 is a Sunday: Friday's rate applies.
      const result = await service.convert(108, 'USD', '2026-03-08');

      expect(result).toEqual({ rate: 1.08, functionalAmount: 100, rateDate: '2026-03-06', source: 'ecb' });
    });

    it('prefers a manual rate over the ECB rate of the same day', async () => {
      rates.push({ currency: 'USD', rateDate: '2026-03-06', rate: '1.20000000', source: 'manual' });

      await expect(service.convert(120, 'USD', '2026-03-06')).resolves.toEqual(
        expect.objectContaining({ rate: 1.2, functionalAmount: 100, source: 'manual' }),
      );
    });

    it('throws when no rate exists or the latest one is older than 14 days', async () => {
      await expect(service.convert(10, 'JPY', '2026-03-06')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.convert(10, 'USD', '2026-03-21')).rejects.toThrow(
        'No exchange rate for USD on or before 2026-03-21',
      );
      // Exactly 14 days old is still accepted.
      await expect(service.convert(10.8, 'USD', '2026-03-20')).resolves.toEqual(
        expect.objectContaining({ rateDate: '2026-03-06' }),
      );
    });

    it('computes cross rates over EUR for a non-EUR functional currency', async () => {
      settings.functionalCurrency = 'CHF';

      const result = await service.convert(108, 'USD', '2026-03-06');

      // 1.08 USD/EUR ÷ 0.95 CHF/EUR = 1.13684211 USD per CHF
      expect(result.rate).toBe(1.13684211);
      expect(result.functionalAmount).toBe(95);
      // EUR itself converts with the inverse CHF rate.
      await expect(service.getRate('EUR', '2026-03-06')).resolves.toEqual({
        rate: 1.05263158,
        rateDate: '2026-03-06',
        source: 'ecb',
      });
    });
  });

  describe('manual rates', () => {
    it('rejects EUR, malformed codes and non-positive rates', async () => {
      await expect(service.setManualRate('eur', '2026-03-06', 1, null)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setManualRate('US', '2026-03-06', 1, null)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setManualRate('USD', '2026-03-06', 0, null)).rejects.toThrow(
        'Rate must be a positive number',
      );
      await expect(service.setManualRate('USD', '2026-03-06', Number.NaN, null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('upserts the manual rate for the date', async () => {
      rates.push({ currency: 'USD', rateDate: '2026-03-06', rate: '1.1', source: 'manual' });

      await expect(service.setManualRate('usd', '2026-03-06', 1.1, 'admin')).resolves.toEqual(
        expect.objectContaining({ source: 'manual' }),
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (currency, rate_date, source) DO UPDATE'),
        ['USD', '2026-03-06', 1.1, 'admin'],
      );
    });
  });

  describe('fetchEcbRates', () => {
    const response = (body: string, init: { ok?: boolean; status?: number; length?: string | null } = {}) => ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: { get: jest.fn(() => init.length ?? null) },
      arrayBuffer: jest.fn(async () => new TextEncoder().encode(body).buffer),
    });

    it('does nothing when the ECB source is disabled', async () => {
      settings.fxSource = 'manual';
      global.fetch = jest.fn() as never;

      await expect(service.fetchEcbRates()).resolves.toBe(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('stores every parsed rate (upsert per currency and day)', async () => {
      global.fetch = jest.fn(async () => response(ECB_SAMPLE)) as never;

      await expect(service.fetchEcbRates()).resolves.toBe(4);

      expect(global.fetch).toHaveBeenCalledWith(settings.ecbRatesUrl, expect.objectContaining({ redirect: 'error' }));
      expect(dataSource.query).toHaveBeenCalledTimes(4);
      expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining("'ecb'"), ['GBP', '2026-03-06', 0.8412]);
    });

    it('fails on HTTP errors and oversized feeds without storing anything', async () => {
      global.fetch = jest.fn(async () => response('', { ok: false, status: 503 })) as never;
      await expect(service.fetchEcbRates()).rejects.toThrow('ECB feed returned HTTP 503');

      global.fetch = jest.fn(async () => response(ECB_SAMPLE, { length: String(10 * 1024 * 1024) })) as never;
      await expect(service.fetchEcbRates()).rejects.toThrow('ECB feed too large');

      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });
});
