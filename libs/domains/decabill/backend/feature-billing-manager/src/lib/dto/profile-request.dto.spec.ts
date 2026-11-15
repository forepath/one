import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';

import { CreateAdminCustomerProfileDto } from './admin-customer-profile.dto';
import { CreateAdminSupplierProfileDto, SupplierProfileFieldsDto } from './admin-supplier-profile.dto';
import { CustomerProfileDto } from './customer-profile.dto';

/** Same options as the app's global pipe (apps/decabill/backend-billing-manager/src/bootstrap.ts). */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype });
/** Console profile dialog payload: optional fields left empty are sent as '' (country is dropped). */
const consoleProfile = () => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  company: '',
  customerType: 'consumer',
  vatId: '',
  addressLine1: 'Main St 1',
  addressLine2: '',
  postalCode: '10115',
  city: 'Berlin',
  state: '',
  email: '',
  phone: '',
});

describe('profile request DTO validation', () => {
  it.each([
    ['admin customer create', CreateAdminCustomerProfileDto, { userId: '3775918b-e48e-45a6-af49-e425013b71b9' }],
    ['customer profile update', CustomerProfileDto, {}],
    ['supplier create', CreateAdminSupplierProfileDto, { customerType: 'business' }],
    ['supplier update', SupplierProfileFieldsDto, { customerType: 'business' }],
  ])('%s accepts the console payload with an empty email', async (_label, metatype, extra) => {
    await expect(pipe.transform({ ...consoleProfile(), ...extra }, meta(metatype))).resolves.toEqual(
      expect.objectContaining({ email: '' }),
    );
  });

  it.each([CreateAdminCustomerProfileDto, CreateAdminSupplierProfileDto])(
    '%p rejects an invalid email and unknown fields',
    async (metatype) => {
      const base = { ...consoleProfile(), userId: '3775918b-e48e-45a6-af49-e425013b71b9' };
      const body = metatype === CreateAdminSupplierProfileDto ? consoleProfile() : base;

      await expect(pipe.transform({ ...body, email: 'not-an-email' }, meta(metatype))).rejects.toThrow(
        BadRequestException,
      );
      await expect(pipe.transform({ ...body, email: 'a@b.de', isAdmin: true }, meta(metatype))).rejects.toThrow(
        BadRequestException,
      );
    },
  );

  it('admin customer create requires a valid userId', async () => {
    await expect(
      pipe.transform({ ...consoleProfile(), userId: 'x' }, meta(CreateAdminCustomerProfileDto)),
    ).rejects.toThrow(BadRequestException);
  });
});
