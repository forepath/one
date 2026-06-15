import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

const DIRECTIONS = ['incoming', 'outgoing', 'bidirectional'] as const;
const FILTER_TYPES = ['none', 'filter', 'drop'] as const;

/**
 * DTO for creating a regex filter rule.
 */
export class CreateRegexFilterRuleDto {
  @IsNotEmpty({ message: 'pattern is required' })
  @IsString()
  @MaxLength(20000, { message: 'pattern is too long' })
  pattern!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  regexFlags?: string;

  @IsIn(DIRECTIONS, { message: 'direction must be incoming, outgoing, or bidirectional' })
  direction!: (typeof DIRECTIONS)[number];

  @IsIn(FILTER_TYPES, { message: 'filterType must be none, filter, or drop' })
  filterType!: (typeof FILTER_TYPES)[number];

  @ValidateIf((o: CreateRegexFilterRuleDto) => o.filterType === 'filter')
  @IsNotEmpty({ message: 'replaceContent is required when filterType is filter' })
  @IsString()
  @MaxLength(20000)
  replaceContent?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
