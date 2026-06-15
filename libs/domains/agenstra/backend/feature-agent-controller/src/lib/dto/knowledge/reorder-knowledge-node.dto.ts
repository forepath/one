import { IsInt, Max, Min } from 'class-validator';

export class ReorderKnowledgeNodeDto {
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder!: number;
}
