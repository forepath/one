import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const DIRECTIONS = ['incoming', 'outgoing', 'bidirectional'] as const;
const FILTER_TYPES = ['none', 'filter', 'drop'] as const;

/**
 * DTO for updating a regex filter rule (all fields optional).
 */
export class UpdateRegexFilterRuleDto {
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
}
