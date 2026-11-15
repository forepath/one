import { DOCUMENT_NOTE_MAX_LENGTH } from '../constants/document-note.constants';

import { sanitizeMultiLineTermsValue } from './document-terms.utils';

/**
 * Normalizes a document note (invoice, credit note, offer): keeps line breaks, drops control characters and other
 * code units that are invalid in XML 1.0 or break the PDF layout, collapses runs of blank lines. Empty input → null.
 */
export function normalizeDocumentNote(value: string | null | undefined): string | null {
  return sanitizeMultiLineTermsValue(value, DOCUMENT_NOTE_MAX_LENGTH);
}
