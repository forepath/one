import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for moving a file or directory.
 */
export class MoveFileDto {
  /**
   * Destination path relative to /app.
   * Supports nested paths.
   */
  @IsString({ message: 'Destination must be a string' })
  @IsNotEmpty({ message: 'Destination path is required' })
  destination!: string;
}
