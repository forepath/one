import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ApplyGeneratedBodyDto {
  @IsUUID('4')
  generationId!: string;

  @IsNotEmpty()
  @IsString()
  content!: string;
}
