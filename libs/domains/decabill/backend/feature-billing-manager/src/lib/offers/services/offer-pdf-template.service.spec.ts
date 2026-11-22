import type { CustomerProfileEntity } from '../../entities/customer-profile.entity';
import type { BillingIssuerConfig } from '../../services/billing-issuer-config.service';
import type { OfferLineItemEntity } from '../entities/offer-line-item.entity';
import type { OfferEntity } from '../entities/offer.entity';

import { OfferPdfTemplateService } from './offer-pdf-template.service';

describe('OfferPdfTemplateService', () => {
  const service = new OfferPdfTemplateService();
  const offer = {
    id: 'off-1',
    offerNumber: 'OFF-2026-00001',
    status: 'sent',
    currency: 'EUR',
    subtotalNet: 100,
    taxTotal: 19,
    totalGross: 119,
    createdAt: new Date('2026-06-01'),
    sentAt: new Date('2026-06-01'),
    expiresAt: new Date('2026-06-30'),
  } as unknown as OfferEntity;
  const lineItems = [
    {
      position: 0,
      description: 'Service',
      quantity: 1,
      unitPriceNet: 100,
      taxRate: 19,
      lineNet: 100,
      lineTax: 19,
      lineGross: 119,
    },
  ] as OfferLineItemEntity[];
  const issuer: BillingIssuerConfig = {
    name: 'Acme GmbH',
    vatId: 'DE123',
    addressLine1: 'Street 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
  };
  const buyer = {
    company: 'Analytical Engines Ltd',
    addressLine1: '42 Computing Lane',
    postalCode: 'SW1A',
    city: 'London',
    country: 'GB',
  } as CustomerProfileEntity;

  it('prints the buyer address without a second line', () => {
    const viewModel = service.buildViewModel(offer, lineItems, issuer, buyer);

    expect(viewModel.issuer.lines).toEqual(['Street 1', '10115 Berlin', 'Germany']);
    expect(viewModel.buyer.lines).toEqual(['42 Computing Lane', 'SW1A London', 'United Kingdom']);
  });

  it('prints the second address line of buyer and issuer between street and city', () => {
    const viewModel = service.buildViewModel(offer, lineItems, { ...issuer, addressLine2: 'Building B' }, {
      ...buyer,
      addressLine2: 'Floor 3',
    } as CustomerProfileEntity);

    expect(viewModel.issuer.lines).toEqual(['Street 1', 'Building B', '10115 Berlin', 'Germany']);
    expect(viewModel.buyer.lines).toEqual(['42 Computing Lane', 'Floor 3', 'SW1A London', 'United Kingdom']);
  });

  it('skips a null or blank second address line', () => {
    const nullLine = service.buildViewModel(offer, lineItems, issuer, {
      ...buyer,
      addressLine2: null,
    } as unknown as CustomerProfileEntity);
    const blankLine = service.buildViewModel(offer, lineItems, issuer, {
      ...buyer,
      addressLine2: '   ',
    } as CustomerProfileEntity);

    expect(nullLine.buyer.lines).toEqual(['42 Computing Lane', 'SW1A London', 'United Kingdom']);
    expect(blankLine.buyer.lines).toEqual(['42 Computing Lane', 'SW1A London', 'United Kingdom']);
  });

  it('prints the second address line escaped in the HTML', () => {
    const html = service.buildHtml(offer, lineItems, issuer, {
      ...buyer,
      addressLine2: '<script>alert(1)</script>',
    } as CustomerProfileEntity);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
