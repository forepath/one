import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO for writing file content.
 * Content should be base64-encoded to support both text and binary files.
 */
export class WriteFileDto {
  /**
   * File content as base64-encoded string.
   * For text files, encode UTF-8 bytes as base64.
   * For binary files, encode raw bytes as base64.
   */
  @IsNotEmpty({ message: 'Content is required' })
  @IsString({ message: 'Content must be a string' })
  content!: string;

  /**
   * Optional encoding indicator: 'utf-8' for text files, 'base64' for binary files.
   * If not provided, defaults to 'utf-8' for backward compatibility.
   */
  @IsOptional()
  @IsEnum(['utf-8', 'base64'], { message: 'Encoding must be utf-8 or base64' })
  encoding?: 'utf-8' | 'base64';
}
