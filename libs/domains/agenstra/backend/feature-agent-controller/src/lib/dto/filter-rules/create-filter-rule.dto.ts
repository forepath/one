import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const DIRECTIONS = ['incoming', 'outgoing', 'bidirectional'] as const;
const FILTER_TYPES = ['none', 'filter', 'drop'] as const;

export class CreateFilterRuleDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(20000)
  pattern!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  regexFlags?: string;

  @IsIn(DIRECTIONS)
  direction!: (typeof DIRECTIONS)[number];

  @IsIn(FILTER_TYPES)
  filterType!: (typeof FILTER_TYPES)[number];

  @ValidateIf((o: CreateFilterRuleDto) => o.filterType === 'filter')
  @IsNotEmpty()
  @IsString()
  @MaxLength(20000)
  replaceContent?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsBoolean()
  isGlobal!: boolean;

  @ValidateIf((o: CreateFilterRuleDto) => !o.isGlobal)
  @IsArray()
  @IsUUID('4', { each: true })
  workspaceIds?: string[];
}
