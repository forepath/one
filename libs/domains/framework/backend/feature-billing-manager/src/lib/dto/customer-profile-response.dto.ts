export class CustomerProfileResponseDto {
  id!: string;
  userId!: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
  stripeCustomerId?: string;
  createdAt!: Date;
  updatedAt!: Date;
}
