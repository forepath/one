import type { ExecutionContext } from '@nestjs/common';

/** Normalized HTTP path without query string or trailing slashes. */
export function getHttpRequestPath(context: ExecutionContext): string {
  const request = context.switchToHttp().getRequest();
  const rawUrl: unknown = request.originalUrl ?? request.url;
  const url = typeof rawUrl === 'string' ? rawUrl : '';

  return url.split('?')[0]?.replace(/\/+$/, '') ?? '';
}
