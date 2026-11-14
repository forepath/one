import {
  documentTermsFormFromTerms,
  documentTermsFormToInput,
  emptyDocumentTermsForm,
  formatDeliveryTermsLabel,
  formatPaymentTermsLabel,
  getDeliveryTermsOptions,
  getDeliveryTermsTextError,
  getPaymentDueDaysError,
  isDocumentTermsFormValid,
  parsePaymentDueDays,
} from './document-terms.util';

describe('document-terms.util', () => {
  it('lists the eleven Incoterms® 2020 rules followed by the manual option', () => {
    const options = getDeliveryTermsOptions();

    expect(options.map((option) => option.value)).toEqual([
      'EXW',
      'FCA',
      'CPT',
      'CIP',
      'DAP',
      'DPU',
      'DDP',
      'FAS',
      'FOB',
      'CFR',
      'CIF',
      'CUSTOM',
    ]);
    expect(options[4].label).toBe('DAP – Delivered at Place');
  });

  it('formats payment terms', () => {
    expect(formatPaymentTermsLabel(null)).toBeUndefined();
    expect(formatPaymentTermsLabel(0)).toBe('Payable immediately');
    expect(formatPaymentTermsLabel(1)).toBe('Payable within 1 day of the invoice date');
    expect(formatPaymentTermsLabel(30)).toBe('Payable within 30 days of the invoice date');
  });

  it('formats delivery terms', () => {
    expect(
      formatDeliveryTermsLabel({ deliveryTermsCode: 'DAP', deliveryTermsPlace: 'Berlin', deliveryTermsText: null }),
    ).toBe('DAP – Delivered at Place, Berlin (Incoterms® 2020)');
    expect(
      formatDeliveryTermsLabel({
        deliveryTermsCode: 'CUSTOM',
        deliveryTermsPlace: null,
        deliveryTermsText: ' Online ',
      }),
    ).toBe('Online');
    expect(
      formatDeliveryTermsLabel({ deliveryTermsCode: null, deliveryTermsPlace: null, deliveryTermsText: null }),
    ).toBeUndefined();
  });

  it('parses payment days (empty = inherit, invalid = NaN)', () => {
    expect(parsePaymentDueDays('')).toBeNull();
    expect(parsePaymentDueDays(null)).toBeNull();
    expect(parsePaymentDueDays('0')).toBe(0);
    expect(parsePaymentDueDays(30)).toBe(30);
    expect(parsePaymentDueDays('1.5')).toBeNaN();
    expect(parsePaymentDueDays('-1')).toBeNaN();
    expect(parsePaymentDueDays('366')).toBeNaN();
  });

  it('maps the form to an API payload that clears inherited fields with null', () => {
    expect(documentTermsFormToInput(emptyDocumentTermsForm())).toEqual({
      paymentDueDays: null,
      deliveryTermsCode: null,
      deliveryTermsPlace: null,
      deliveryTermsText: null,
    });
    expect(
      documentTermsFormToInput({
        paymentDueDays: '21',
        deliveryTermsCode: 'FCA',
        deliveryTermsPlace: ' Hamburg ',
        deliveryTermsText: 'stale custom text',
      }),
    ).toEqual({ paymentDueDays: 21, deliveryTermsCode: 'FCA', deliveryTermsPlace: 'Hamburg', deliveryTermsText: null });
    expect(
      documentTermsFormToInput({
        paymentDueDays: '',
        deliveryTermsCode: 'CUSTOM',
        deliveryTermsPlace: 'stale place',
        deliveryTermsText: ' Online access ',
      }),
    ).toEqual({
      paymentDueDays: null,
      deliveryTermsCode: 'CUSTOM',
      deliveryTermsPlace: null,
      deliveryTermsText: 'Online access',
    });
  });

  it('round-trips stored terms into the form', () => {
    expect(
      documentTermsFormFromTerms({
        paymentDueDays: 0,
        deliveryTermsCode: 'DAP',
        deliveryTermsPlace: 'Berlin',
        deliveryTermsText: null,
      }),
    ).toEqual({ paymentDueDays: 0, deliveryTermsCode: 'DAP', deliveryTermsPlace: 'Berlin', deliveryTermsText: '' });
    expect(documentTermsFormFromTerms(null)).toEqual(emptyDocumentTermsForm());
  });

  it('validates the form', () => {
    const form = emptyDocumentTermsForm();

    expect(isDocumentTermsFormValid(form)).toBe(true);

    form.deliveryTermsCode = 'CUSTOM';
    expect(getDeliveryTermsTextError(form)).toBe('Enter the delivery terms.');
    expect(isDocumentTermsFormValid(form)).toBe(false);

    form.deliveryTermsText = 'Online access';
    form.paymentDueDays = '400';
    expect(getPaymentDueDaysError(form)).toContain('365');
    expect(isDocumentTermsFormValid(form)).toBe(false);
    expect(isDocumentTermsFormValid(form, false)).toBe(true);
  });
});
