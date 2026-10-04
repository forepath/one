import type { AdminFileManagerView } from '../constants/admin-file-manager.constants';

export type AdminFileManagerEntryType = 'file' | 'directory';

export interface AdminFileManagerEntryDto {
  name: string;
  path: string;
  type: AdminFileManagerEntryType;
  size?: number;
  contentType?: string;
  scope?: string;
  updatedAt?: string;
  id?: string;
  shas?: { short: string; long: string };
  contentHashes?: { md5: string; sha1: string; sha256: string; sha512: string };
  byteSize?: number;
  signature?: {
    status: 'signed' | 'pending';
    alg?: string;
    version?: string;
    value?: string;
    signedAt?: string;
    tenantId?: string;
  };
}

export interface AdminFileManagerListResponseDto {
  path: string;
  view: AdminFileManagerView;
  viewTenantId?: string;
  entries: AdminFileManagerEntryDto[];
}
