import { BadRequestException } from '@nestjs/common';

import { DeliveryTermsCode } from '../constants/document-terms.constants';

import {
  deliveryTermsFromColumns,
  documentTermsLayerFromFields,
  formatDeliveryTerms,
  formatPaymentTerms,
  hasDeliveryTermsInput,
  normalizeDeliveryTermsInput,
  normalizePaymentDueDaysInput,
  resolveDocumentTerms,
  sanitizeMultiLineTermsValue,
  sanitizeSingleLineTermsValue,
  toDocumentTermsColumns,
} from './document-terms.utils';

describe('document-terms.utils', () => {
  describe('normalizeDeliveryTermsInput', () => {
    it('returns null (inherit) for an empty code', () => {
      expect(normalizeDeliveryTermsInput({})).toBeNull();
      expect(normalizeDeliveryTermsInput({ deliveryTermsCode: null, deliveryTermsText: 'ignored' })).toBeNull();
      expect(normalizeDeliveryTermsInput({ deliveryTermsCode: '' })).toBeNull();
    });

    it('keeps the named place for Incoterms rules and drops text', () => {
      expect(
        normalizeDeliveryTermsInput({
          deliveryTermsCode: DeliveryTermsCode.FCA,
          deliveryTermsPlace: '  Hamburg \t Port ',
          deliveryTermsText: 'ignored',
        }),
      ).toEqual({ code: DeliveryTermsCode.FCA, place: 'Hamburg Port', text: null });
    });

    it('requires text for CUSTOM and drops the place', () => {
      expect(
        normalizeDeliveryTermsInput({
          deliveryTermsCode: DeliveryTermsCode.CUSTOM,
          deliveryTermsPlace: 'ignored',
          deliveryTermsText: ' Online access\r\nwithin 24h ',
        }),
      ).toEqual({ code: DeliveryTermsCode.CUSTOM, place: null, text: 'Online access\nwithin 24h' });
      expect(() =>
        normalizeDeliveryTermsInput({ deliveryTermsCode: DeliveryTermsCode.CUSTOM, deliveryTermsText: '  \n ' }),
      ).toThrow(BadRequestException);
    });

    it('rejects unknown codes', () => {
      expect(() => normalizeDeliveryTermsInput({ deliveryTermsCode: 'DAT' })).toThrow(BadRequestException);
      expect(() => normalizeDeliveryTermsInput({ deliveryTermsCode: 'dap' })).toThrow(BadRequestException);
    });
  });

  describe('sanitizers', () => {
    it('strips control characters that are invalid in XML 1.0', () => {
      expect(sanitizeMultiLineTermsValue('a\u0000b\u0007c\u001Bd\u007Fe\u0085f\tg\nh', 100)).toBe('abcdef g\nh');
      expect(sanitizeSingleLineTermsValue('a\u0000b\nc\u0009d', 100)).toBe('a b c d');
    });

    it('collapses runs of blank lines and truncates to the limit', () => {
      expect(sanitizeMultiLineTermsValue('a\n\n\n\nb', 100)).toBe('a\n\nb');
      expect(sanitizeSingleLineTermsValue('x'.repeat(300), 255)).toHaveLength(255);
    });
  });

  describe('normalizePaymentDueDaysInput', () => {
    it('accepts 0..365 and null', () => {
      expect(normalizePaymentDueDaysInput(undefined)).toBeNull();
      expect(normalizePaymentDueDaysInput(null)).toBeNull();
      expect(normalizePaymentDueDaysInput(0)).toBe(0);
      expect(normalizePaymentDueDaysInput(365)).toBe(365);
    });

    it.each([-1, 366, 1.5, Number.NaN])('rejects %p', (value) => {
      expect(() => normalizePaymentDueDaysInput(value)).toThrow(BadRequestException);
    });
  });

  it('detects touched delivery fields for partial updates', () => {
    expect(hasDeliveryTermsInput({})).toBe(false);
    expect(hasDeliveryTermsInput({ deliveryTermsPlace: 'Berlin' })).toBe(true);
    expect(hasDeliveryTermsInput({ deliveryTermsCode: null })).toBe(true);
  });

  describe('deliveryTermsFromColumns', () => {
    it('ignores unknown codes and empty custom text from storage', () => {
      expect(deliveryTermsFromColumns({ deliveryTermsCode: 'XYZ' })).toBeNull();
      expect(
        deliveryTermsFromColumns({ deliveryTermsCode: DeliveryTermsCode.CUSTOM, deliveryTermsText: '' }),
      ).toBeNull();
      expect(deliveryTermsFromColumns(null)).toBeNull();
    });
  });

  describe('resolveDocumentTerms', () => {
    const fallback = { paymentDueDays: 14, deliveryTerms: null };
    const plan = documentTermsLayerFromFields({
      paymentDueDays: 30,
      deliveryTermsCode: DeliveryTermsCode.DAP,
      deliveryTermsPlace: 'Berlin',
    });

    it('resolves payment and delivery independently, first layer wins', () => {
      const resolved = resolveDocumentTerms(
        [{ paymentDueDays: null, deliveryTerms: { code: DeliveryTermsCode.EXW, place: null, text: null } }, plan],
        fallback,
      );

      expect(resolved).toEqual({
        paymentDueDays: 30,
        deliveryTerms: { code: DeliveryTermsCode.EXW, place: null, text: null },
      });
    });

    it('falls back to the global default and keeps 0 days', () => {
      expect(resolveDocumentTerms([undefined, null, {}], fallback)).toEqual(fallback);
      expect(resolveDocumentTerms([{ paymentDueDays: 0 }, plan], fallback).paymentDueDays).toBe(0);
    });

    it('maps resolved terms to columns', () => {
      expect(toDocumentTermsColumns(resolveDocumentTerms([plan], fallback))).toEqual({
        paymentDueDays: 30,
        deliveryTermsCode: DeliveryTermsCode.DAP,
        deliveryTermsPlace: 'Berlin',
        deliveryTermsText: null,
      });
    });
  });

  describe('formatting', () => {
    it('formats Incoterms with and without a named place', () => {
      expect(formatDeliveryTerms({ code: DeliveryTermsCode.DDP, place: 'Vienna, Austria', text: null })).toBe(
        'DDP – Delivered Duty Paid, Vienna, Austria (Incoterms® 2020)',
      );
      expect(formatDeliveryTerms({ code: DeliveryTermsCode.EXW, place: null, text: null })).toBe(
        'EXW – Ex Works (Incoterms® 2020)',
      );
      expect(formatDeliveryTerms({ code: DeliveryTermsCode.CUSTOM, place: null, text: 'Online access' })).toBe(
        'Online access',
      );
      expect(formatDeliveryTerms(null)).toBeUndefined();
    });

    it('formats payment terms', () => {
      expect(formatPaymentTerms(null)).toBeUndefined();
      expect(formatPaymentTerms(0)).toBe('Payable immediately without deduction.');
      expect(formatPaymentTerms(1)).toBe('Payable within 1 day of the invoice date without deduction.');
      expect(formatPaymentTerms(30)).toBe('Payable within 30 days of the invoice date without deduction.');
    });
  });
});
