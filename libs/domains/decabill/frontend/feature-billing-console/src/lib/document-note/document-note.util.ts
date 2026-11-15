import { DOCUMENT_NOTE_MAX_LENGTH } from '@forepath/decabill/frontend/data-access-billing-console';

/** Request value for a note field: trimmed text, or null when blank (the backend treats null as "no note"). */
export function documentNoteToInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed ? trimmed : null;
}

/** True when the note fits the backend limit (blank notes are always valid). */
export function isDocumentNoteValid(value: string | null | undefined): boolean {
  return (value?.trim().length ?? 0) <= DOCUMENT_NOTE_MAX_LENGTH;
}
