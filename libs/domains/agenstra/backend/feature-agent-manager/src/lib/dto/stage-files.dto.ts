import { IsArray, IsOptional, IsString } from 'class-validator';

/**
 * DTO for staging files.
 */
export class StageFilesDto {
  /**
   * Array of file paths to stage (relative to repository root).
   * If empty or omitted, stage all changes.
   */
  @IsOptional()
  @IsArray({ message: 'Files must be an array' })
  @IsString({ each: true, message: 'Each file path must be a string' })
  files?: string[];
}
