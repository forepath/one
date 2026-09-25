import { IsEnum, IsNotEmpty } from 'class-validator';

/**
 * DTO for creating an empty file or directory.
 * Write content separately via PUT raw bytes.
 */
export class CreateFileDto {
  @IsNotEmpty({ message: 'Type is required' })
  @IsEnum(['file', 'directory'], { message: 'Type must be file or directory' })
  type!: 'file' | 'directory';
}
