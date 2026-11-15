import { BadRequestException } from '@nestjs/common';

import { ProjectPricingModel } from '../../projects/entities/project.enums';
import type { OfferProjectTemplateLineDto } from '../dto/offer.dto';

import {
  buildOfferProjectTemplatePayload,
  mapOfferProjectTemplateLineToTaxInput,
  resolveOfferProjectTemplateLinePricing,
} from './map-offer-line-items.util';

const line = (overrides: Partial<OfferProjectTemplateLineDto> = {}): OfferProjectTemplateLineDto => ({
  description: 'Website',
  name: 'Website project',
  hourlyRateNet: 100,
  ...overrides,
});

describe('offer project template line pricing', () => {
  it('keeps hourly estimates as target hours × rate', () => {
    expect(resolveOfferProjectTemplateLinePricing(line({ targetHours: 40 }))).toEqual({
      quantity: 40,
      unitPriceNet: 100,
      unitLabel: 'hour',
    });
    expect(resolveOfferProjectTemplateLinePricing(line())).toEqual({
      quantity: 1,
      unitPriceNet: 100,
      unitLabel: 'hour',
    });
  });

  it('prices capped and fixed lines at the limit', () => {
    for (const pricingModel of [ProjectPricingModel.CAPPED, ProjectPricingModel.FIXED]) {
      expect(
        resolveOfferProjectTemplateLinePricing(line({ pricingModel, priceLimitNet: 4800, targetHours: 60 })),
      ).toEqual({ quantity: 1, unitPriceNet: 4800, unitLabel: null });
      expect(mapOfferProjectTemplateLineToTaxInput(line({ pricingModel, priceLimitNet: 4800 }))).toEqual(
        expect.objectContaining({ quantity: 1, unitPriceNet: 4800 }),
      );
    }
  });

  it('rejects capped / fixed lines without a limit', () => {
    expect(() => resolveOfferProjectTemplateLinePricing(line({ pricingModel: ProjectPricingModel.FIXED }))).toThrow(
      BadRequestException,
    );
  });

  it('stores pricing in the template payload', () => {
    expect(
      buildOfferProjectTemplatePayload(line({ pricingModel: ProjectPricingModel.CAPPED, priceLimitNet: 4800 })),
    ).toEqual(
      expect.objectContaining({ hourlyRateNet: 100, pricingModel: ProjectPricingModel.CAPPED, priceLimitNet: 4800 }),
    );
    expect(buildOfferProjectTemplatePayload(line({ priceLimitNet: 10 }))).toEqual(
      expect.objectContaining({ pricingModel: ProjectPricingModel.HOURLY, priceLimitNet: null }),
    );
  });
});
