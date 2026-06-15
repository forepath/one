import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for updating an environment variable.
 */
export class UpdateEnvironmentVariableDto {
  @IsNotEmpty({ message: 'Variable name is required' })
  @IsString({ message: 'Variable name must be a string' })
  variable!: string;

  @IsNotEmpty({ message: 'Content is required' })
  @IsString({ message: 'Content must be a string' })
  content!: string;
}
