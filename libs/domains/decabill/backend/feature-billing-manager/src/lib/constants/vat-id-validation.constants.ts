export enum VatIdValidationStatus {
  NONE = 'none',
  PENDING = 'pending',
  VALID = 'valid',
  INVALID = 'invalid',
  UNAVAILABLE = 'unavailable',
}

export enum VatIdValidationSource {
  VIES_SYNC = 'vies_sync',
  VIES_ASYNC = 'vies_async',
  ADMIN = 'admin',
  FORMAT_ONLY = 'format_only',
}
