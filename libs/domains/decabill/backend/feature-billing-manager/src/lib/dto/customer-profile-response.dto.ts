import type { CustomerType } from '../constants/customer-type.constants';
import type { VatIdValidationSource, VatIdValidationStatus } from '../constants/vat-id-validation.constants';

export class CustomerProfileResponseDto {
  id!: string;
  userId!: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  customerType?: CustomerType | null;
  vatId?: string | null;
  vatIdValidationStatus?: VatIdValidationStatus;
  vatIdValidatedAt?: Date | null;
  vatIdValidationSource?: VatIdValidationSource | null;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
  stripeCustomerId?: string;
  autoBillingEnabled?: boolean;
  hasPaymentMethodOnFile?: boolean;
  supportsAutoPayment?: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
