import * as fs from 'fs';
import * as path from 'path';

const TEMPLATE_FILE_NAME = 'invoice-pdf.template.html';
let cachedTemplate: string | undefined;

export function loadInvoicePdfTemplate(): string {
  if (cachedTemplate !== undefined) {
    return cachedTemplate;
  }

  cachedTemplate = fs.readFileSync(resolveInvoicePdfTemplatePath(), 'utf-8');

  return cachedTemplate;
}

function resolveInvoicePdfTemplatePath(): string {
  const candidates = [
    path.join(__dirname, 'templates', TEMPLATE_FILE_NAME),
    path.join(__dirname, TEMPLATE_FILE_NAME),
    path.join(__dirname, '..', 'templates', TEMPLATE_FILE_NAME),
    path.resolve(
      process.cwd(),
      'libs/domains/agenstra/backend/feature-billing-manager/src/lib/templates',
      TEMPLATE_FILE_NAME,
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Invoice PDF template not found (${TEMPLATE_FILE_NAME})`);
}

/** @internal Test helper to reset memoized template between test cases. */
export function resetInvoicePdfTemplateCacheForTests(): void {
  cachedTemplate = undefined;
}
