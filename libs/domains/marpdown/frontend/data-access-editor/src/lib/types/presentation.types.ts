import type { ExportFormat } from '@forepath/marpdown/marpdown/shared';

export interface PresentationSummaryDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface PresentationResponseDto extends PresentationSummaryDto {
  markdown: string;
}

export interface CreatePresentationDto {
  title: string;
  markdown?: string;
}

export interface UpdatePresentationDto {
  title?: string;
  markdown?: string;
}

export interface ImportPresentationDto {
  markdown: string;
}

export interface ListPresentationsParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedPresentationsResponseDto {
  items: PresentationSummaryDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface FileNodeDto {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
}

export interface AssetContentDto {
  content: string;
  encoding: 'base64';
  mimeType: string;
  size: number;
}

export interface WriteAssetDto {
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface CreateAssetDto {
  type: 'file' | 'directory';
  content?: string;
  encoding?: 'utf-8' | 'base64';
  mimeType?: string;
}

export interface MoveAssetDto {
  destinationPath: string;
}

export interface ExportPresentationDto {
  format: ExportFormat;
}

export type { ExportFormat };
