/**
 * Logical file groups under `{FILE_STORAGE_ROOT}/{segment}/`.
 * Segments are fixed; call sites must not invent free-form scope strings.
 */
export const FileStorageScope = {
  customerInvoices: 'customerInvoices',
  customerOffers: 'customerOffers',
  customerTimesheets: 'customerTimesheets',
  supplierInvoices: 'supplierInvoices',
  datevExports: 'datevExports',
} as const;

export type FileStorageScope = (typeof FileStorageScope)[keyof typeof FileStorageScope];

/** Directory segment under `FILE_STORAGE_ROOT` for each scope (may be nested). */
export const FILE_STORAGE_SCOPE_SEGMENTS: Readonly<Record<FileStorageScope, string>> = {
  [FileStorageScope.customerInvoices]: 'customer/invoices',
  [FileStorageScope.customerOffers]: 'customer/offers',
  [FileStorageScope.customerTimesheets]: 'customer/timesheets',
  [FileStorageScope.supplierInvoices]: 'supplier/invoices',
  [FileStorageScope.datevExports]: 'export/datev',
};

export const FILE_STORAGE_SCOPES: readonly FileStorageScope[] = [
  FileStorageScope.customerInvoices,
  FileStorageScope.customerOffers,
  FileStorageScope.customerTimesheets,
  FileStorageScope.supplierInvoices,
  FileStorageScope.datevExports,
];

/**
 * Pre-layout-split segments (dual-read + layout migrator sources).
 * Relative keys under these roots match historical Decabill storage.
 */
export const FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS = {
  invoices: 'invoices',
  supplierInvoices: 'supplier-invoices',
  datevExports: 'datev-exports',
} as const;
