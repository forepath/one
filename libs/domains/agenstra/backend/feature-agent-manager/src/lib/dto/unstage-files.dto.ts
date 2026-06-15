import { IsArray, IsOptional, IsString } from 'class-validator';

/**
 * DTO for unstaging files.
 */
export class UnstageFilesDto {
  /**
   * Array of file paths to unstage (relative to repository root).
   * If empty or omitted, unstage all changes.
   */
  @IsOptional()
  @IsArray({ message: 'Files must be an array' })
  @IsString({ each: true, message: 'Each file path must be a string' })
  files?: string[];
}
