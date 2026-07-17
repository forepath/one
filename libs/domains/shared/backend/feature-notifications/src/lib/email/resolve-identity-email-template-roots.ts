import * as path from 'path';

/**
 * Resolve template roots for shared identity email Handlebars files.
 */
export function resolveIdentityEmailTemplateRoots(): string[] {
  return [
    path.join(__dirname, '..', 'templates'),
    path.join(__dirname, 'templates'),
    path.resolve(process.cwd(), 'templates'),
    path.resolve(process.cwd(), 'libs/domains/shared/backend/feature-notifications/src/lib/templates'),
  ];
}
