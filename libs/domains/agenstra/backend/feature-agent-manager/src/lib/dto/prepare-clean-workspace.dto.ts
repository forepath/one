import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * Request body to reset the agent repo to a clean upstream tip (orchestrator-only dangerous ops).
 */
export class PrepareCleanWorkspaceDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-zA-Z0-9/_-]+$/, {
    message: 'baseBranch may only contain letters, digits, /, _, and -',
  })
  baseBranch!: string;
}
