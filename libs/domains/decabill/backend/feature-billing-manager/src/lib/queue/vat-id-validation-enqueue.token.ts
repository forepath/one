export const VAT_ID_VALIDATION_ENQUEUE = Symbol('VAT_ID_VALIDATION_ENQUEUE');

export interface VatIdValidationUnitPayload {
  profileId: string;
  userId: string;
  vatId: string;
  tenantId?: string;
}

export interface VatIdValidationEnqueuePort {
  enqueueUnit(payload: VatIdValidationUnitPayload): Promise<void>;
}
