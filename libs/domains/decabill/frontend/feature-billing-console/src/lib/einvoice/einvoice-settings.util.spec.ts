import {
  einvoiceFormatRequiresBuyerReference,
  einvoiceFormatRequiresEndpoint,
  einvoiceSettingsPayload,
  getEinvoiceFormatLabel,
  isEinvoiceEndpointValid,
} from './einvoice-settings.util';

describe('einvoice settings util', () => {
  it('knows which formats need a buyer reference / endpoint', () => {
    expect(einvoiceFormatRequiresBuyerReference('xrechnung-cii')).toBe(true);
    expect(einvoiceFormatRequiresBuyerReference('peppol-bis-3')).toBe(false);
    expect(einvoiceFormatRequiresBuyerReference(null)).toBe(false);
    expect(einvoiceFormatRequiresEndpoint('xrechnung-ubl')).toBe(true);
    expect(einvoiceFormatRequiresEndpoint('peppol-bis-3')).toBe(true);
    expect(einvoiceFormatRequiresEndpoint('factur-x-en16931')).toBe(false);
  });

  it('validates the scheme:id endpoint', () => {
    expect(isEinvoiceEndpointValid('')).toBe(true);
    expect(isEinvoiceEndpointValid('0088:4012345000009')).toBe(true);
    expect(isEinvoiceEndpointValid('9930:DE123456789')).toBe(true);
    expect(isEinvoiceEndpointValid('4012345000009')).toBe(false);
    expect(isEinvoiceEndpointValid('0088:40 12')).toBe(false);
  });

  it('labels a format from the capabilities list', () => {
    const formats = [{ format: 'xrechnung-cii', label: 'XRechnung 3.0 (CII)' }];

    expect(getEinvoiceFormatLabel('xrechnung-cii', formats)).toBe('XRechnung 3.0 (CII)');
    expect(getEinvoiceFormatLabel('unknown', formats)).toBe('unknown');
    expect(getEinvoiceFormatLabel(null, formats)).toBe('');
  });

  it('normalizes empty values to null and keeps absent fields absent', () => {
    expect(
      einvoiceSettingsPayload({ einvoiceFormat: '', buyerReference: ' 991-12345-67 ', einvoiceEndpoint: '  ' }),
    ).toEqual({ einvoiceFormat: null, buyerReference: '991-12345-67', einvoiceEndpoint: null });
    expect(einvoiceSettingsPayload({ buyerReference: 'X' })).toEqual({ buyerReference: 'X' });
  });
});
