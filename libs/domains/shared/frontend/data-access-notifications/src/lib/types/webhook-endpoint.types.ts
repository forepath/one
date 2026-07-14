export enum WebhookHttpMethod {
  POST = 'POST',
  GET = 'GET',
}

export enum WebhookAuthType {
  NONE = 'none',
  AUTHORIZATION = 'authorization',
  CUSTOM_HEADER = 'custom_header',
  QUERY_PARAM = 'query_param',
}

export interface CreateWebhookEndpointDto {
  name: string;
  url: string;
  httpMethod: WebhookHttpMethod;
  subscribedEvents: string[];
  enabled?: boolean;
  authType: WebhookAuthType;
  authHeaderName?: string;
  authValue?: string;
  clientId?: string;
  deliveryLogRetentionDays?: number;
  deliveryLogMaxEntries?: number;
}

export interface UpdateWebhookEndpointDto {
  name?: string;
  url?: string;
  httpMethod?: WebhookHttpMethod;
  subscribedEvents?: string[];
  enabled?: boolean;
  authType?: WebhookAuthType;
  authHeaderName?: string;
  authValue?: string;
  clientId?: string | null;
  deliveryLogRetentionDays?: number | null;
  deliveryLogMaxEntries?: number | null;
}

export interface WebhookEndpointResponseDto {
  id: string;
  scopeKey: string;
  clientId?: string | null;
  name: string;
  url: string;
  httpMethod: WebhookHttpMethod;
  subscribedEvents: string[];
  enabled: boolean;
  authType: WebhookAuthType;
  authHeaderName?: string | null;
  hasAuthValue: boolean;
  consecutiveFailures: number;
  disabledReason?: string | null;
  deliveryLogRetentionDays?: number | null;
  deliveryLogMaxEntries?: number | null;
  createdAt: string;
  updatedAt: string;
  signingSecret?: string;
}

export interface WebhookDeliveryResponseDto {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  httpStatus?: number | null;
  responseBody?: string | null;
  success: boolean;
  attempt: number;
  errorMessage?: string | null;
  createdAt: string;
}

export interface PaginatedWebhookDeliveriesResponseDto {
  items: WebhookDeliveryResponseDto[];
  total: number;
}

export interface WebhookEventTypeResponseDto {
  type: string;
  description: string;
}

export interface ListWebhookEndpointsParams {
  limit?: number;
  offset?: number;
}

export interface ListWebhookDeliveriesParams {
  limit?: number;
  offset?: number;
}
