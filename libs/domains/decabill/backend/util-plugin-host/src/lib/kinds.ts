export const DECABILL_EXTENSION_KINDS = {
  PAYMENT_PROCESSOR: 'payment-processor',
  BILLING_PROVISIONING_PROVIDER: 'billing-provisioning-provider',
} as const;

export type DecabillExtensionKind = (typeof DECABILL_EXTENSION_KINDS)[keyof typeof DECABILL_EXTENSION_KINDS];
