import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { JOIN_TOKEN_MAX_TTL_MINUTES } from '../constants/control-plane.constants';

export class CreateJoinTokenDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  site?: string;

  @IsOptional()
  @IsObject()
  labels?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  witness?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(JOIN_TOKEN_MAX_TTL_MINUTES)
  ttlMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export interface JoinTokenResponseDto {
  id: string;
  tokenPrefix: string;
  description: string | null;
  site: string;
  labels: Record<string, string>;
  witness: boolean;
  expiresAt: string;
  usedAt: string | null;
  usedByNode: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Returned once on creation; the plaintext token is never shown again. */
export interface CreatedJoinTokenDto extends JoinTokenResponseDto {
  token: string;
}
