import { normalizeDocumentNote } from './document-note.utils';

describe('normalizeDocumentNote', () => {
  it('returns null for missing or blank notes', () => {
    expect(normalizeDocumentNote(undefined)).toBeNull();
    expect(normalizeDocumentNote(null)).toBeNull();
    expect(normalizeDocumentNote(' \n\t\r\n ')).toBeNull();
  });

  it('keeps line breaks, trims lines and collapses blank-line runs', () => {
    expect(normalizeDocumentNote('  First  line \r\n\r\n\r\n\r\n  Second\rThird ')).toBe('First line\n\nSecond\nThird');
  });

  it('drops control characters that are invalid in XML 1.0', () => {
    expect(normalizeDocumentNote('A\u0000B\u0007C\u001BD\u009FE')).toBe('ABCDE');
  });

  it('drops lone surrogates and U+FFFE / U+FFFF but keeps valid astral characters', () => {
    expect(normalizeDocumentNote('a\uD800b\uDC00c\uFFFEd\uFFFFe 😀')).toBe('abcde 😀');
  });

  it('does not split a surrogate pair when capping the length', () => {
    const capped = normalizeDocumentNote(`${'x'.repeat(1999)}😀`);

    expect(capped).toBe('x'.repeat(1999));
  });

  it('caps the note at 2000 characters', () => {
    expect(normalizeDocumentNote('x'.repeat(2500))).toHaveLength(2000);
  });
});
