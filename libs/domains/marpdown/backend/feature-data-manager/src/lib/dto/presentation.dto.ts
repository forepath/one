import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { PRESENTATION_TITLE_MAX_LENGTH } from '@forepath/marpdown/marpdown/shared';

export class CreatePresentationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRESENTATION_TITLE_MAX_LENGTH)
  title!: string;

  @IsOptional()
  @IsString()
  markdown?: string;
}

export class UpdatePresentationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRESENTATION_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  markdown?: string;
}

export class ImportPresentationDto {
  @IsString()
  @IsNotEmpty()
  markdown!: string;
}

export class PresentationSummaryDto {
  id!: string;
  title!: string;
  createdAt!: string;
  updatedAt!: string;
}

export class PresentationResponseDto extends PresentationSummaryDto {
  markdown!: string;
}

export class PaginatedPresentationsResponseDto {
  items!: PresentationSummaryDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
