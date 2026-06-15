import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class VerifierShellCommandDto {
  @IsString()
  cmd!: string;

  @IsOptional()
  @IsString()
  cwd?: string;
}

export class RunVerifierCommandsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VerifierShellCommandDto)
  @ArrayMaxSize(32)
  commands!: VerifierShellCommandDto[];

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(3_600_000)
  timeoutMs?: number;
}

export class VerifierCommandResultDto {
  cmd!: string;
  exitCode!: number;
  output!: string;
}

export class RunVerifierCommandsResponseDto {
  results!: VerifierCommandResultDto[];
}
