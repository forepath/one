import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for rebasing a branch.
 */
export class RebaseDto {
  /**
   * Branch name to rebase onto.
   */
  @IsNotEmpty({ message: 'Branch is required' })
  @IsString({ message: 'Branch must be a string' })
  branch!: string;
}
