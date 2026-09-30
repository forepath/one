import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Body for POST /agents/:id/permissions/:permissionId/reply
 */
export class ReplyPermissionDto {
  @IsIn(['once', 'always', 'reject'])
  reply!: 'once' | 'always' | 'reject';

  @IsOptional()
  @IsString()
  sessionId?: string;
}

/**
 * Body for POST /agents/:id/questions/:questionId/reply (forms / questions).
 */
export class ReplyQuestionDto {
  @IsOptional()
  @IsString({ each: true })
  answers?: string[];

  @IsOptional()
  @IsIn(['reject'])
  reply?: 'reject';

  @IsOptional()
  @IsString()
  sessionId?: string;
}
