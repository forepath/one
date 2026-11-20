import { BadRequestException } from '@nestjs/common';

import { ProjectPricingModel } from '../../projects/entities/project.enums';
import type { OfferProjectTemplateLineDto } from '../dto/offer.dto';
import type { OfferLineItemEntity } from '../entities/offer-line-item.entity';

import {
  buildOfferProjectTemplatePayload,
  mapOfferLineItemToResponse,
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

describe('mapOfferLineItemToResponse internal fields', () => {
  const line = {
    id: 'l1',
    position: 0,
    lineType: 'plan_template',
    description: 'Plan',
    quantity: '1',
    unitPriceNet: '13',
    taxCategory: 'standard',
    taxRate: '19',
    lineNet: '13',
    lineTax: '2.47',
    lineGross: '15.47',
    fulfillmentStatus: 'pending',
    inventoryArticleId: '6f9619ff-8b86-4011-b42d-00c04fc964ff',
    pricingSnapshot: { basePrice: 10, marginPercent: 20, marginFixed: 1, totalPrice: 13, grandTotal: 13 },
  } as unknown as OfferLineItemEntity;

  it('keeps base price, margins and the article for admins', () => {
    const response = mapOfferLineItemToResponse(line, { includeInternal: true });

    expect(response.inventoryArticleId).toBe(line.inventoryArticleId);
    expect(response.pricingSnapshot).toEqual(line.pricingSnapshot);
  });

  it('removes them for customers but keeps the final prices', () => {
    const response = mapOfferLineItemToResponse(line);

    expect(response).not.toHaveProperty('inventoryArticleId');
    expect(response.pricingSnapshot).toEqual({ totalPrice: 13, grandTotal: 13 });
  });
});
