import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { WebhookAuthType, WebhookHttpMethod } from '../entities/webhook-endpoint.entity';

const WEBHOOK_ENDPOINT_URL_OPTIONS = {
  require_protocol: true,
  protocols: ['https', 'http'],
  require_tld: false,
};

export class CreateWebhookEndpointDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsUrl(WEBHOOK_ENDPOINT_URL_OPTIONS)
  url!: string;

  @IsEnum(WebhookHttpMethod)
  httpMethod!: WebhookHttpMethod;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  subscribedEvents!: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsEnum(WebhookAuthType)
  authType!: WebhookAuthType;

  @ValidateIf((dto: CreateWebhookEndpointDto) => dto.authType === WebhookAuthType.CUSTOM_HEADER)
  @IsString()
  @IsNotEmpty()
  authHeaderName?: string;

  @ValidateIf((dto: CreateWebhookEndpointDto) =>
    [WebhookAuthType.AUTHORIZATION, WebhookAuthType.CUSTOM_HEADER, WebhookAuthType.QUERY_PARAM].includes(dto.authType),
  )
  @IsString()
  @IsNotEmpty()
  authValue?: string;

  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  deliveryLogRetentionDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  deliveryLogMaxEntries?: number;
}

export class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUrl(WEBHOOK_ENDPOINT_URL_OPTIONS)
  url?: string;

  @IsOptional()
  @IsEnum(WebhookHttpMethod)
  httpMethod?: WebhookHttpMethod;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  subscribedEvents?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(WebhookAuthType)
  authType?: WebhookAuthType;

  @ValidateIf((dto: UpdateWebhookEndpointDto) => dto.authType === WebhookAuthType.CUSTOM_HEADER)
  @IsString()
  @IsNotEmpty()
  authHeaderName?: string;

  @ValidateIf(
    (dto: UpdateWebhookEndpointDto) =>
      dto.authType !== undefined &&
      [WebhookAuthType.AUTHORIZATION, WebhookAuthType.CUSTOM_HEADER, WebhookAuthType.QUERY_PARAM].includes(
        dto.authType,
      ),
  )
  @IsString()
  @IsNotEmpty()
  authValue?: string;

  @IsOptional()
  @IsUUID('4')
  clientId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  deliveryLogRetentionDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  deliveryLogMaxEntries?: number | null;
}

export class WebhookEndpointResponseDto {
  id!: string;
  scopeKey!: string;
  clientId?: string | null;
  name!: string;
  url!: string;
  httpMethod!: WebhookHttpMethod;
  subscribedEvents!: string[];
  enabled!: boolean;
  authType!: WebhookAuthType;
  authHeaderName?: string | null;
  hasAuthValue!: boolean;
  consecutiveFailures!: number;
  disabledReason?: string | null;
  deliveryLogRetentionDays?: number | null;
  deliveryLogMaxEntries?: number | null;
  createdAt!: Date;
  updatedAt!: Date;
  signingSecret?: string;
}

export class WebhookDeliveryResponseDto {
  id!: string;
  endpointId!: string;
  eventId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  httpStatus?: number | null;
  responseBody?: string | null;
  success!: boolean;
  attempt!: number;
  errorMessage?: string | null;
  createdAt!: Date;
}

export class PaginatedWebhookDeliveriesResponseDto {
  items!: WebhookDeliveryResponseDto[];
  total!: number;
}

export class WebhookEventTypeResponseDto {
  type!: string;
  description!: string;
}

export class ListWebhookEventTypesQueryDto {
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  offset?: number;
}
