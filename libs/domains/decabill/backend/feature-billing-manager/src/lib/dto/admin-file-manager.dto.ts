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
}

export interface AdminFileManagerListResponseDto {
  path: string;
  view: AdminFileManagerView;
  viewTenantId?: string;
  entries: AdminFileManagerEntryDto[];
}
