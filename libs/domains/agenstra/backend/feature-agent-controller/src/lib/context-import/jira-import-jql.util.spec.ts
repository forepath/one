import { buildJiraIssueSearchJql, resolveJiraBoardIdForAgileApi } from './jira-import-jql.util';

describe('resolveJiraBoardIdForAgileApi', () => {
  it('returns positive integers', () => {
    expect(resolveJiraBoardIdForAgileApi(42)).toBe(42);
    expect(resolveJiraBoardIdForAgileApi('99')).toBe(99);
  });

  it('returns null for missing, zero, negative, or invalid values', () => {
    expect(resolveJiraBoardIdForAgileApi(null)).toBeNull();
    expect(resolveJiraBoardIdForAgileApi(undefined)).toBeNull();
    expect(resolveJiraBoardIdForAgileApi(0)).toBeNull();
    expect(resolveJiraBoardIdForAgileApi(-1)).toBeNull();
    expect(resolveJiraBoardIdForAgileApi(Number.NaN)).toBeNull();
    expect(resolveJiraBoardIdForAgileApi('')).toBeNull();
    expect(resolveJiraBoardIdForAgileApi('0')).toBeNull();
    expect(resolveJiraBoardIdForAgileApi(' 12a')).toBeNull();
  });
});

describe('buildJiraIssueSearchJql', () => {
  it('appends order by updated when order by is absent', () => {
    expect(buildJiraIssueSearchJql('project = FOO')).toBe('project = FOO order by updated DESC');
  });

  it('preserves existing order by', () => {
    expect(buildJiraIssueSearchJql('project = FOO order by created ASC')).toBe('project = FOO order by created ASC');
  });
});
