export type WebhookHttpMethod = 'POST' | 'GET';

export type WebhookAuthType = 'none' | 'authorization' | 'custom_header' | 'query_param';

export interface WebhookAuthConfig {
  authType: WebhookAuthType;
  authValue?: string | null;
  authHeaderName?: string | null;
}

export interface WebhookDeliveryRequest {
  url: string;
  method: WebhookHttpMethod;
  auth: WebhookAuthConfig;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface WebhookDeliveryResult {
  httpStatus: number | null;
  responseBody: string | null;
  success: boolean;
  errorMessage?: string;
}
