import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';

import { BillProjectTimeDto } from '../projects/dto/project.dto';

import { VoidInvoiceDto } from './admin-billing.dto';
import { CreateManualInvoiceDto, UpdateManualInvoiceDto } from './manual-invoice.dto';

/** Same options as the app's global pipe (apps/decabill/backend-billing-manager/src/bootstrap.ts). */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });
const lineItems = [{ description: 'Consulting', quantity: 1, unitPriceNet: 100 }];
const bodies: Array<[string, ArgumentMetadata['metatype'], Record<string, unknown>]> = [
  ['manual invoice create', CreateManualInvoiceDto, { userId: '3775918b-e48e-45a6-af49-e425013b71b9', lineItems }],
  ['manual invoice update', UpdateManualInvoiceDto, { lineItems }],
  ['project bill-time', BillProjectTimeDto, { from: '2026-11-01T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }],
  ['void', VoidInvoiceDto, {}],
];

async function validationMessages(metatype: ArgumentMetadata['metatype'], body: unknown): Promise<string> {
  try {
    await pipe.transform(body, meta(metatype));
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);

    return JSON.stringify((error as BadRequestException).getResponse());
  }

  throw new Error('expected validation to fail');
}

describe('Document note request validation (global ValidationPipe options)', () => {
  it.each(bodies)('%s accepts a missing, null or multi-line note', async (_label, metatype, body) => {
    await expect(pipe.transform(body, meta(metatype))).resolves.toBeDefined();
    await expect(pipe.transform({ ...body, note: null }, meta(metatype))).resolves.toBeDefined();

    const result = (await pipe.transform({ ...body, note: 'Line one\nLine two' }, meta(metatype))) as {
      note?: string;
    };

    expect(result.note).toBe('Line one\nLine two');
  });

  it.each(bodies)('%s rejects non-string and overlong notes', async (_label, metatype, body) => {
    await expect(validationMessages(metatype, { ...body, note: { $ne: '' } })).resolves.toContain(
      'note must be a string',
    );
    await expect(validationMessages(metatype, { ...body, note: 'x'.repeat(2001) })).resolves.toContain(
      'note must be at most 2000 characters',
    );
  });

  it('void rejects unknown fields', async () => {
    await expect(validationMessages(VoidInvoiceDto, { reason: 'x' })).resolves.toContain('reason');
  });
});
