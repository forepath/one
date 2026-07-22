export const BILLING_QUEUE_NAME = 'billing';

export const AdminBillNowJobName = {
  COORDINATOR: 'admin-bill-now.coordinator',
  UNIT: 'admin-bill-now.unit',
} as const;

export const DatevExportJobName = {
  COORDINATOR: 'datev-export.coordinator',
  UNIT: 'datev-export.unit',
} as const;

export const VatIdValidationJobName = {
  UNIT: 'vat-id-validation.unit',
} as const;
