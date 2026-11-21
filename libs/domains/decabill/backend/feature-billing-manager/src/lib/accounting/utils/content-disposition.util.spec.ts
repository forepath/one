import { attachmentDisposition } from './content-disposition.util';

describe('attachmentDisposition', () => {
  it('keeps plain ASCII names', () => {
    expect(attachmentDisposition('statement.xml')).toBe(
      `attachment; filename="statement.xml"; filename*=UTF-8''statement.xml`,
    );
  });

  it('strips header-breaking characters from the fallback', () => {
    const value = attachmentDisposition('a"b\\c\r\nSet-Cookie: x=1.csv');

    expect(value).not.toMatch(/[\r\n]/);
    expect(value.split(';')[1]).toBe(' filename="a_b_c__Set-Cookie: x=1.csv"');
  });

  it('encodes non-ASCII names in filename*', () => {
    expect(attachmentDisposition('Kontoauszug März.pdf')).toContain(`filename*=UTF-8''Kontoauszug%20M%C3%A4rz.pdf`);
    expect(attachmentDisposition('Kontoauszug März.pdf')).toContain('filename="Kontoauszug M_rz.pdf"');
  });

  it('falls back for empty names', () => {
    expect(attachmentDisposition('')).toContain('filename="download"');
  });
});
