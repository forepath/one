export const AdminFileManagerView = {
  TENANT: 'tenant',
  UNIFIED: 'unified',
} as const;

export type AdminFileManagerView = (typeof AdminFileManagerView)[keyof typeof AdminFileManagerView];

/** Max files included in a single archive download. */
export const ADMIN_FILE_MANAGER_MAX_ARCHIVE_ENTRIES = 500;

/** Max total uncompressed bytes for a single archive download (~100 MiB). */
export const ADMIN_FILE_MANAGER_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

/** Max upload size for authenticity verify (same ballpark as supplier invoice docs). */
export const ADMIN_FILE_MANAGER_MAX_VERIFY_BYTES = 15 * 1024 * 1024;

export const AdminFileVerifyVerdict = {
  AUTHENTIC: 'authentic',
  UNKNOWN: 'unknown',
  UNSIGNED: 'unsigned',
  SIGNING_DISABLED: 'signing_disabled',
} as const;

export type AdminFileVerifyVerdict = (typeof AdminFileVerifyVerdict)[keyof typeof AdminFileVerifyVerdict];
