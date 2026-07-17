import * as path from 'path';

/**
 * Resolve template roots for Decabill email Handlebars files
 * (co-located with invoice PDF templates).
 */
export function resolveBillingEmailTemplateRoots(): string[] {
  return [
    path.join(__dirname, 'templates'),
    path.join(__dirname, '..', 'templates'),
    path.resolve(process.cwd(), 'templates'),
    path.resolve(process.cwd(), 'libs/domains/decabill/backend/feature-billing-manager/src/lib/templates'),
  ];
}
