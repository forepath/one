import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for creating a new environment variable.
 */
export class CreateEnvironmentVariableDto {
  @IsNotEmpty({ message: 'Variable name is required' })
  @IsString({ message: 'Variable name must be a string' })
  variable!: string;

  @IsNotEmpty({ message: 'Content is required' })
  @IsString({ message: 'Content must be a string' })
  content!: string;
}
