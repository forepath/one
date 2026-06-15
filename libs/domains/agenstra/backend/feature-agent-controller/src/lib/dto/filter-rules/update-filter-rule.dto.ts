import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

const DIRECTIONS = ['incoming', 'outgoing', 'bidirectional'] as const;
const FILTER_TYPES = ['none', 'filter', 'drop'] as const;

export class UpdateFilterRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  pattern?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  regexFlags?: string;

  @IsOptional()
  @IsIn(DIRECTIONS)
  direction?: (typeof DIRECTIONS)[number];

  @IsOptional()
  @IsIn(FILTER_TYPES)
  filterType?: (typeof FILTER_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  replaceContent?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  workspaceIds?: string[];
}
