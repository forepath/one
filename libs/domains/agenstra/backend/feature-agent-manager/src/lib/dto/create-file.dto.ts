import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO for creating a file or directory.
 */
export class CreateFileDto {
  @IsNotEmpty({ message: 'Type is required' })
  @IsEnum(['file', 'directory'], { message: 'Type must be file or directory' })
  type!: 'file' | 'directory';

  @IsOptional()
  @IsString({ message: 'Content must be a string' })
  content?: string;
}
