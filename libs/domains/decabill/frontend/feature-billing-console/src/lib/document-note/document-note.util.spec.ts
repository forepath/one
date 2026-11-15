import { documentNoteToInput, isDocumentNoteValid } from './document-note.util';

describe('document-note.util', () => {
  it('maps blank notes to null and trims text', () => {
    expect(documentNoteToInput(undefined)).toBeNull();
    expect(documentNoteToInput('  \n ')).toBeNull();
    expect(documentNoteToInput('  Line one\nLine two  ')).toBe('Line one\nLine two');
  });

  it('validates the length limit', () => {
    expect(isDocumentNoteValid('')).toBe(true);
    expect(isDocumentNoteValid('x'.repeat(2000))).toBe(true);
    expect(isDocumentNoteValid('x'.repeat(2001))).toBe(false);
  });
});
