import type { AdminFileManagerView, AdminFileVerifyVerdict } from '../constants/admin-file-manager.constants';

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

export interface AdminFileVerifyMatchDto {
  id: string;
  shas: { short: string; long: string };
  tenantId: string;
  scope: string;
  storageKey: string;
  virtualPath: string;
  signature?: {
    status: 'signed' | 'pending';
    alg?: string;
    version?: string;
    value?: string;
    signedAt?: string;
    tenantId?: string;
  };
}

export interface AdminFileVerifyResponseDto {
  verdict: AdminFileVerifyVerdict;
  contentSha256?: string;
  match?: AdminFileVerifyMatchDto;
}
