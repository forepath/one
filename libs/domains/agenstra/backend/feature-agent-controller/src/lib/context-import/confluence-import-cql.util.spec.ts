import { buildConfluenceImportSearchCql } from './confluence-import-cql.util';

describe('buildConfluenceImportSearchCql', () => {
  it('appends default order by when missing', () => {
    expect(buildConfluenceImportSearchCql('type = page', null, null)).toBe('type = page order by lastModified desc');
  });

  it('preserves user order by clause', () => {
    expect(buildConfluenceImportSearchCql('type = page order by title asc', null, null)).toBe(
      'type = page order by title asc',
    );
  });

  it('ANDs space key when set', () => {
    expect(buildConfluenceImportSearchCql('type = page', 'TEAM', null)).toBe(
      '(type = page) AND space = "TEAM" order by lastModified desc',
    );
  });

  it('ANDs root page subtree when set', () => {
    expect(buildConfluenceImportSearchCql('type = page', null, '987654321')).toBe(
      '(type = page) AND (id = 987654321 OR ancestor = 987654321) order by lastModified desc',
    );
  });

  it('quotes non-numeric root page id', () => {
    expect(buildConfluenceImportSearchCql('type = page', null, 'abc')).toBe(
      '(type = page) AND (id = "abc" OR ancestor = "abc") order by lastModified desc',
    );
  });

  it('combines space and root with user order by', () => {
    expect(buildConfluenceImportSearchCql('type = page ORDER BY lastModified DESC', 'SPC', '1')).toBe(
      '(type = page) AND space = "SPC" AND (id = 1 OR ancestor = 1) ORDER BY lastModified DESC',
    );
  });

  it('escapes quotes in space key', () => {
    expect(buildConfluenceImportSearchCql('type = page', 'TE"AM', null)).toBe(
      '(type = page) AND space = "TE\\"AM" order by lastModified desc',
    );
  });
});
