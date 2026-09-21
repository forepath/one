import * as fs from 'fs';
import * as path from 'path';

const TEMPLATE_FILE_NAME = 'offer-pdf.template.html';
let cachedTemplate: string | undefined;

export function loadOfferPdfTemplate(): string {
  if (cachedTemplate !== undefined) {
    return cachedTemplate;
  }

  cachedTemplate = fs.readFileSync(resolveOfferPdfTemplatePath(), 'utf-8');

  return cachedTemplate;
}

function resolveOfferPdfTemplatePath(): string {
  const candidates = [
    path.join(__dirname, 'templates', TEMPLATE_FILE_NAME),
    path.join(__dirname, TEMPLATE_FILE_NAME),
    path.join(__dirname, '..', 'templates', TEMPLATE_FILE_NAME),
    path.join(process.cwd(), 'templates', TEMPLATE_FILE_NAME),
    path.resolve(
      process.cwd(),
      'libs/domains/decabill/backend/feature-billing-manager/src/lib/offers/templates',
      TEMPLATE_FILE_NAME,
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Offer PDF template not found (${TEMPLATE_FILE_NAME})`);
}

/** @internal Test helper to reset memoized template between test cases. */
export function resetOfferPdfTemplateCacheForTests(): void {
  cachedTemplate = undefined;
}
