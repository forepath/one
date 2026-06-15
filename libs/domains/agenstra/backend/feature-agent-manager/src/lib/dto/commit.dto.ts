import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for committing changes.
 */
export class CommitDto {
  /**
   * Commit message.
   */
  @IsNotEmpty({ message: 'Message is required' })
  @IsString({ message: 'Message must be a string' })
  message!: string;
}
