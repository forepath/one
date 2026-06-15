import { IsBoolean, IsOptional } from 'class-validator';

/**
 * DTO for push options.
 */
export class PushOptionsDto {
  /**
   * Whether to force push using `--force-with-lease`.
   */
  @IsOptional()
  @IsBoolean({ message: 'Force must be a boolean' })
  force?: boolean;
}
