import * as path from 'path';

import type { EmailSubjectRegistry } from '@forepath/shared/backend/util-email';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

export const LOADWEAVER_EMAIL_SUBJECTS: EmailSubjectRegistry = {
  'alert-firing': (ctx) => `[${asString(ctx.severity).toUpperCase()}] ${asString(ctx.title)}`,
  'alert-resolved': (ctx) => `[RESOLVED] ${asString(ctx.title)}`,
};

/** Where Loadweaver's email templates live (built next to the code, or in the source tree). */
export function resolveLoadweaverEmailTemplateRoots(): string[] {
  return [
    path.join(__dirname, 'templates'),
    path.join(__dirname, '..', 'templates'),
    path.resolve(process.cwd(), 'templates'),
    path.resolve(process.cwd(), 'libs/domains/loadweaver/backend/feature-control-plane/src/lib/templates'),
  ];
}
