import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';

import { ArchiveAdminOfferDto, RevokeAdminOfferDto } from '../offers/dto/offer.dto';
import { BillProjectTimeDto } from '../projects/dto/project.dto';

import { VoidInvoiceDto } from './admin-billing.dto';
import { shouldNotify } from './document-delivery.dto';
import { IssueManualInvoiceDto } from './manual-invoice.dto';

/** Same options as the app's global pipe (apps/decabill/backend-billing-manager/src/bootstrap.ts). */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });
const billTime = { from: '2026-11-01T00:00:00.000Z', to: '2026-11-30T23:59:59.000Z' };

describe('notification flags on finalizing actions (global ValidationPipe options)', () => {
  const cases: Array<[string, ArgumentMetadata['metatype'], Record<string, unknown>, string]> = [
    ['archive offer', ArchiveAdminOfferDto, {}, 'notifyCustomer'],
    ['archive offer (expiry)', ArchiveAdminOfferDto, {}, 'notifyOnExpiry'],
    ['revoke offer', RevokeAdminOfferDto, {}, 'notifyCustomer'],
    ['void invoice', VoidInvoiceDto, {}, 'notifyCustomer'],
    ['issue invoice', IssueManualInvoiceDto, {}, 'notifyCustomer'],
    ['bill project time', BillProjectTimeDto, billTime, 'notifyCustomer'],
  ];

  it.each(cases)('%s: accepts the flag omitted, true or false', async (_label, metatype, base, field) => {
    await expect(pipe.transform({ ...base }, meta(metatype))).resolves.toBeDefined();
    await expect(pipe.transform({ ...base, [field]: true }, meta(metatype))).resolves.toEqual(
      expect.objectContaining({ [field]: true }),
    );
    await expect(pipe.transform({ ...base, [field]: false }, meta(metatype))).resolves.toEqual(
      expect.objectContaining({ [field]: false }),
    );
  });

  it.each(cases)('%s: rejects non-boolean values (no string coercion)', async (_label, metatype, base, field) => {
    for (const value of ['false', 'true', 0, 1, 'yes', {}]) {
      await expect(pipe.transform({ ...base, [field]: value }, meta(metatype))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('rejects unknown properties next to the flag', async () => {
    await expect(
      pipe.transform({ notifyCustomer: false, sentAt: '2020-01-01' }, meta(ArchiveAdminOfferDto)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ notifyCustomer: false, voidDocumentSentAt: '2020-01-01' }, meta(VoidInvoiceDto)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('notifies unless the caller explicitly passed false', () => {
    expect(shouldNotify(undefined)).toBe(true);
    expect(shouldNotify(null)).toBe(true);
    expect(shouldNotify(true)).toBe(true);
    expect(shouldNotify(false)).toBe(false);
  });
});
