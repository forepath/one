import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO for creating a new branch.
 */
export class CreateBranchDto {
  /**
   * Branch name (will be prefixed with conventional commit prefix if not already present).
   * User can override with custom name.
   */
  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name!: string;

  /**
   * Whether to use conventional commit prefix (feat/, fix/, chore/, etc.).
   * If false, use the name as-is.
   */
  @IsOptional()
  @IsBoolean({ message: 'Use conventional prefix must be a boolean' })
  useConventionalPrefix?: boolean;

  /**
   * Conventional commit type (feat, fix, chore, etc.).
   * Only used if useConventionalPrefix is true.
   */
  @IsOptional()
  @IsEnum(['feat', 'fix', 'chore', 'docs', 'style', 'refactor', 'test', 'perf'], {
    message: 'Conventional type must be one of: feat, fix, chore, docs, style, refactor, test, perf',
  })
  conventionalType?: 'feat' | 'fix' | 'chore' | 'docs' | 'style' | 'refactor' | 'test' | 'perf';

  /**
   * Base branch to create from (defaults to current branch).
   */
  @IsOptional()
  @IsString({ message: 'Base branch must be a string' })
  baseBranch?: string;
}
