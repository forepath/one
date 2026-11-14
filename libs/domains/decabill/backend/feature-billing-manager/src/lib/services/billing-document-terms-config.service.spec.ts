import { DeliveryTermsCode } from '../constants/document-terms.constants';

import { BillingDocumentTermsConfigService } from './billing-document-terms-config.service';

describe('BillingDocumentTermsConfigService', () => {
  const envKeys = [
    'BILLING_DEFAULT_PAYMENT_DUE_DAYS',
    'BILLING_DEFAULT_DELIVERY_TERMS_CODE',
    'BILLING_DEFAULT_DELIVERY_TERMS_PLACE',
    'BILLING_DEFAULT_DELIVERY_TERMS_TEXT',
  ] as const;
  const createService = (): BillingDocumentTermsConfigService => {
    const service = new BillingDocumentTermsConfigService();

    service.onModuleInit();

    return service;
  };

  afterEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  it('defaults to 14 days and no delivery terms', () => {
    expect(createService().getDefaults()).toEqual({ paymentDueDays: 14, deliveryTerms: null });
  });

  it('reads payment days and an Incoterms rule (case-insensitive) with place', () => {
    process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS = '30';
    process.env.BILLING_DEFAULT_DELIVERY_TERMS_CODE = ' fca ';
    process.env.BILLING_DEFAULT_DELIVERY_TERMS_PLACE = 'Hamburg';

    expect(createService().getDefaults()).toEqual({
      paymentDueDays: 30,
      deliveryTerms: { code: DeliveryTermsCode.FCA, place: 'Hamburg', text: null },
    });
  });

  it('reads custom delivery terms text', () => {
    process.env.BILLING_DEFAULT_DELIVERY_TERMS_CODE = 'CUSTOM';
    process.env.BILLING_DEFAULT_DELIVERY_TERMS_TEXT = 'Online access within 24 hours';

    expect(createService().getDefaults().deliveryTerms).toEqual({
      code: DeliveryTermsCode.CUSTOM,
      place: null,
      text: 'Online access within 24 hours',
    });
  });

  it.each(['-1', '366', '1.5', 'abc'])('ignores invalid payment days %p', (value) => {
    process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS = value;

    expect(createService().getDefaults().paymentDueDays).toBe(14);
  });

  it('ignores an unknown code or CUSTOM without text', () => {
    process.env.BILLING_DEFAULT_DELIVERY_TERMS_CODE = 'DAT';
    expect(createService().getDefaults().deliveryTerms).toBeNull();

    process.env.BILLING_DEFAULT_DELIVERY_TERMS_CODE = 'CUSTOM';
    expect(createService().getDefaults().deliveryTerms).toBeNull();
  });

  it('resolves layers before the defaults', () => {
    process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS = '30';
    const service = createService();

    expect(service.resolve({ paymentDueDays: 7 }, { paymentDueDays: 10 }).paymentDueDays).toBe(7);
    expect(service.resolve(undefined, { paymentDueDays: null }).paymentDueDays).toBe(30);
  });
});
