import { applyDecorators } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { DOCUMENT_NOTE_MAX_LENGTH } from '../constants/document-note.constants';

/**
 * Optional document note (invoice, credit note, offer). Omitted / null / blank means "no note"; the value is
 * normalized with `normalizeDocumentNote` before it is stored.
 */
export function IsOptionalDocumentNote(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsString({ message: 'note must be a string' }),
    MaxLength(DOCUMENT_NOTE_MAX_LENGTH, { message: `note must be at most ${DOCUMENT_NOTE_MAX_LENGTH} characters` }),
  );
}
