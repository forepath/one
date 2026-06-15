import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for resolving merge conflicts.
 */
export class ResolveConflictDto {
  /**
   * File path with conflict (relative to repository root).
   */
  @IsNotEmpty({ message: 'Path is required' })
  @IsString({ message: 'Path must be a string' })
  path!: string;

  /**
   * Merge strategy: 'yours' (accept incoming), 'mine' (accept current), 'both' (keep both).
   */
  @IsNotEmpty({ message: 'Strategy is required' })
  @IsEnum(['yours', 'mine', 'both'], { message: 'Strategy must be yours, mine, or both' })
  strategy!: 'yours' | 'mine' | 'both';
}
