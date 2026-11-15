import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';

import { CreateAdminOfferDto, UpdateAdminOfferDto } from './offer.dto';

/** Same options as the app's global pipe (apps/decabill/backend-billing-manager/src/bootstrap.ts). */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });
const userId = '3775918b-e48e-45a6-af49-e425013b71b9';

async function validationMessages(body: unknown): Promise<string> {
  try {
    await pipe.transform(body, meta(CreateAdminOfferDto));
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);

    return JSON.stringify((error as BadRequestException).getResponse());
  }

  throw new Error('expected validation to fail');
}

/** Payload shape produced by the console (`admin-offers-page` submit + `mapOfferFormLinesToDto`). */
const consoleOffer = () => ({
  userId,
  expiresAt: '2026-12-01T10:00',
  billToOpenPositions: false,
  paymentDueDays: null,
  deliveryTermsCode: null,
  deliveryTermsPlace: null,
  deliveryTermsText: null,
  lineItems: [
    {
      lineType: 'standard',
      payload: { description: 'Setup', quantity: 2, unitPriceNet: 150, taxCategory: 'standard', unitLabel: 'h' },
    },
    {
      lineType: 'project_template',
      payload: {
        description: 'Build',
        name: 'Website',
        hourlyRateNet: 100,
        projectDescription: 'Relaunch',
        targetHours: 40,
        pricingModel: 'capped',
        priceLimitNet: 3500,
        scheduledAt: '2026-12-02T09:00:00.000Z',
      },
    },
    {
      lineType: 'plan_template',
      payload: {
        description: 'Hosting',
        planId: '2b1d1e1c-6a0c-4a43-9c1a-0d5e3f9f7a11',
        requestedConfig: { region: 'nbg1' },
        addonIds: ['8f8b0f4e-2d7c-4d84-9a4b-55e3a1c3f0d2'],
        addonConfigs: { '8f8b0f4e-2d7c-4d84-9a4b-55e3a1c3f0d2': { size: 'l' } },
        autoBackorder: true,
        promotionCode: 'WELCOME',
      },
    },
  ],
});

describe('Offer request DTO validation (global ValidationPipe options)', () => {
  it.each([
    ['create', CreateAdminOfferDto],
    ['update', UpdateAdminOfferDto],
  ])('accepts the console %s payload unchanged', async (_label, metatype) => {
    const result = (await pipe.transform(consoleOffer(), meta(metatype))) as CreateAdminOfferDto;

    expect(result.lineItems).toHaveLength(3);
    expect(result.lineItems.map((line) => line.lineType)).toEqual(['standard', 'project_template', 'plan_template']);
    expect(result.lineItems[1]?.payload).toEqual(
      expect.objectContaining({ pricingModel: 'capped', priceLimitNet: 3500, hourlyRateNet: 100 }),
    );
    expect(result.lineItems[2]?.payload).toEqual(
      expect.objectContaining({ requestedConfig: { region: 'nbg1' }, autoBackorder: true }),
    );
  });

  it('accepts a minimal hourly project line without pricing fields', async () => {
    const body = {
      userId,
      lineItems: [{ lineType: 'project_template', payload: { description: 'Build', name: 'Site', hourlyRateNet: 90 } }],
    };

    await expect(pipe.transform(body, meta(CreateAdminOfferDto))).resolves.toBeDefined();
  });

  it.each([
    ['unknown top-level field', { evil: true }, 'evil'],
    ['invalid userId', { userId: 'nope' }, 'userId'],
    ['empty line list', { lineItems: [] }, 'lineItems'],
    ['unknown line type', { lineItems: [{ lineType: 'bogus', payload: {} }] }, 'lineType'],
  ])('rejects %s', async (_label, patch, field) => {
    await expect(validationMessages({ ...consoleOffer(), ...patch })).resolves.toContain(field);
  });

  it.each([
    ['unknown payload field', { evil: true }, 'evil'],
    ['invalid pricing model', { pricingModel: 'weekly' }, 'pricingModel'],
    ['zero price limit', { priceLimitNet: 0 }, 'priceLimitNet'],
    ['price limit as text', { priceLimitNet: 'abc' }, 'priceLimitNet'],
    ['negative hourly rate', { hourlyRateNet: -1 }, 'hourlyRateNet'],
  ])('rejects a project line with %s', async (_label, patch, field) => {
    const body = consoleOffer();

    Object.assign(body.lineItems[1]!.payload, patch);

    const messages = await validationMessages(body);

    expect(messages).toContain(field);
    expect(messages).not.toContain('description should not exist');
  });

  it('accepts a document note and rejects non-string or overlong notes', async () => {
    const result = (await pipe.transform(
      { ...consoleOffer(), note: 'Valid for 30 days' },
      meta(CreateAdminOfferDto),
    )) as CreateAdminOfferDto;

    expect(result.note).toBe('Valid for 30 days');
    await expect(pipe.transform({ ...consoleOffer(), note: null }, meta(UpdateAdminOfferDto))).resolves.toBeDefined();
    await expect(validationMessages({ ...consoleOffer(), note: 42 })).resolves.toContain('note must be a string');
    await expect(validationMessages({ ...consoleOffer(), note: 'x'.repeat(2001) })).resolves.toContain(
      'note must be at most 2000 characters',
    );
  });

  it('rejects a standard line with a non-positive quantity', async () => {
    const body = consoleOffer();

    Object.assign(body.lineItems[0]!.payload, { quantity: 0 });

    await expect(validationMessages(body)).resolves.toContain('quantity');
  });
});
