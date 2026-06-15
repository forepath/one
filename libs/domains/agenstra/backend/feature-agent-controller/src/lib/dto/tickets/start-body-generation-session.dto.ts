import { IsOptional, IsUUID } from 'class-validator';

export class StartBodyGenerationSessionDto {
  @IsOptional()
  @IsUUID('4')
  agentId?: string;
}
