import { BadRequestException } from '@nestjs/common';

import { ProjectPricingModel } from '../entities/project.enums';

import {
  computeProjectOpenBillableAmountNet,
  computeProjectRemainingPriceNet,
  computeProjectTimeCharge,
  resolveProjectPricing,
  toProjectPricingTerms,
  type ProjectPricingTerms,
} from './project-pricing.utils';

const terms = (overrides: Partial<ProjectPricingTerms> = {}): ProjectPricingTerms => ({
  pricingModel: ProjectPricingModel.HOURLY,
  hourlyRateNet: 100,
  priceLimitNet: null,
  billedAmountNet: 0,
  ...overrides,
});

describe('project pricing utils', () => {
  describe('resolveProjectPricing', () => {
    it('defaults to hourly and drops a price limit', () => {
      expect(resolveProjectPricing(undefined, undefined)).toEqual({
        pricingModel: ProjectPricingModel.HOURLY,
        priceLimitNet: null,
      });
      expect(resolveProjectPricing(ProjectPricingModel.HOURLY, 500)).toEqual({
        pricingModel: ProjectPricingModel.HOURLY,
        priceLimitNet: null,
      });
    });

    it.each([ProjectPricingModel.CAPPED, ProjectPricingModel.FIXED])('requires a positive limit for %s', (model) => {
      expect(() => resolveProjectPricing(model, undefined)).toThrow(BadRequestException);
      expect(() => resolveProjectPricing(model, null)).toThrow(BadRequestException);
      expect(() => resolveProjectPricing(model, 0)).toThrow(BadRequestException);
      expect(() => resolveProjectPricing(model, -5)).toThrow(BadRequestException);
      expect(() => resolveProjectPricing(model, Number.NaN)).toThrow(BadRequestException);
      expect(() => resolveProjectPricing(model, 1e12)).toThrow(BadRequestException);
      expect(() => resolveProjectPricing(model, '500' as unknown as number)).toThrow(BadRequestException);
      expect(resolveProjectPricing(model, 1200)).toEqual({ pricingModel: model, priceLimitNet: 1200 });
    });

    it('rejects unknown models', () => {
      expect(() => resolveProjectPricing('weekly' as ProjectPricingModel, 10)).toThrow(BadRequestException);
    });
  });

  describe('computeProjectTimeCharge', () => {
    it('bills hourly time without limit', () => {
      expect(computeProjectTimeCharge(terms(), 90)).toEqual({ amountNet: 150, timeValueNet: 150, capApplied: false });
    });

    it('caps time at the remaining maximum price', () => {
      const capped = terms({ pricingModel: ProjectPricingModel.CAPPED, priceLimitNet: 1000, billedAmountNet: 950 });

      expect(computeProjectTimeCharge(capped, 60)).toEqual({ amountNet: 50, timeValueNet: 100, capApplied: true });
      expect(computeProjectTimeCharge({ ...capped, billedAmountNet: 0 }, 60)).toEqual({
        amountNet: 100,
        timeValueNet: 100,
        capApplied: false,
      });
      expect(computeProjectTimeCharge({ ...capped, billedAmountNet: 1200 }, 60).amountNet).toBe(0);
    });

    it('bills the remaining fixed price or an instalment up to it', () => {
      const fixed = terms({ pricingModel: ProjectPricingModel.FIXED, priceLimitNet: 5000, billedAmountNet: 1000 });

      expect(computeProjectTimeCharge(fixed, 1).amountNet).toBe(4000);
      expect(computeProjectTimeCharge(fixed, 1, 1500).amountNet).toBe(1500);
      expect(computeProjectTimeCharge(fixed, 1, 4000).amountNet).toBe(4000);
      expect(() => computeProjectTimeCharge(fixed, 1, 4000.02)).toThrow(BadRequestException);
      expect(() => computeProjectTimeCharge(fixed, 1, 0)).toThrow(BadRequestException);
      expect(() => computeProjectTimeCharge(fixed, 1, -10)).toThrow(BadRequestException);
      expect(() => computeProjectTimeCharge(fixed, 1, Number.NaN)).toThrow(BadRequestException);
      expect(() => computeProjectTimeCharge(fixed, 1, '100' as unknown as number)).toThrow(BadRequestException);
    });

    it('only accepts a custom amount for fixed-price projects', () => {
      expect(() => computeProjectTimeCharge(terms(), 60, 10)).toThrow(BadRequestException);
      expect(() =>
        computeProjectTimeCharge(terms({ pricingModel: ProjectPricingModel.CAPPED, priceLimitNet: 100 }), 60, 10),
      ).toThrow(BadRequestException);
    });
  });

  it('computes remaining and open billable amounts', () => {
    expect(computeProjectRemainingPriceNet(terms())).toBeNull();
    expect(computeProjectOpenBillableAmountNet(terms(), 120)).toBe(200);

    const capped = terms({ pricingModel: ProjectPricingModel.CAPPED, priceLimitNet: 1000, billedAmountNet: 900 });

    expect(computeProjectRemainingPriceNet(capped)).toBe(100);
    expect(computeProjectOpenBillableAmountNet(capped, 120)).toBe(100);
    expect(computeProjectOpenBillableAmountNet(capped, 30)).toBe(50);

    const fixed = terms({ pricingModel: ProjectPricingModel.FIXED, priceLimitNet: 5000, billedAmountNet: 5000.001 });

    expect(computeProjectRemainingPriceNet(fixed)).toBe(0);
    expect(computeProjectOpenBillableAmountNet({ ...fixed, billedAmountNet: 2000 }, 0)).toBe(3000);
  });

  it('maps entities with decimal strings and legacy rows', () => {
    expect(
      toProjectPricingTerms({
        pricingModel: undefined as unknown as ProjectPricingModel,
        hourlyRateNet: '120.5000' as unknown as number,
        priceLimitNet: null,
        billedAmountNet: undefined as unknown as number,
      }),
    ).toEqual({
      pricingModel: ProjectPricingModel.HOURLY,
      hourlyRateNet: 120.5,
      priceLimitNet: null,
      billedAmountNet: 0,
    });
  });
});
