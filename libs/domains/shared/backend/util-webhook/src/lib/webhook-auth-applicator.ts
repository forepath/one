import { BadRequestException } from '@nestjs/common';

import type { WebhookAuthConfig, WebhookHttpMethod } from './webhook.types';

export interface AppliedWebhookAuth {
  headers: Record<string, string>;
  queryParams: Record<string, string>;
}

export function assertWebhookAuthCompatible(method: WebhookHttpMethod, auth: WebhookAuthConfig): void {
  if (auth.authType === 'query_param' && method !== 'GET') {
    throw new BadRequestException('Query parameter authentication is only supported for GET requests');
  }

  if (auth.authType === 'custom_header' && !auth.authHeaderName?.trim()) {
    throw new BadRequestException('Custom header name is required for custom_header authentication');
  }

  if (
    (auth.authType === 'authorization' || auth.authType === 'custom_header' || auth.authType === 'query_param') &&
    !auth.authValue?.trim()
  ) {
    throw new BadRequestException('Authentication value is required for the selected authentication type');
  }
}

export function applyWebhookAuth(auth: WebhookAuthConfig, queryParamName = 'token'): AppliedWebhookAuth {
  const headers: Record<string, string> = {};
  const queryParams: Record<string, string> = {};

  switch (auth.authType) {
    case 'authorization':
      headers.Authorization = auth.authValue ?? '';
      break;
    case 'custom_header':
      headers[auth.authHeaderName!.trim()] = auth.authValue ?? '';
      break;
    case 'query_param':
      queryParams[queryParamName] = auth.authValue ?? '';
      break;
    case 'none':
    default:
      break;
  }

  return { headers, queryParams };
}
