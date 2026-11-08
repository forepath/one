import {
  emptyAtlassianConnectionForm,
  hasAtlassianConnectionFormErrors,
  toCreateAtlassianConnectionDto,
  toUpdateAtlassianConnectionDto,
  validateAtlassianConnectionForm,
} from './atlassian-connection-form.util';

describe('atlassian-connection-form.util', () => {
  it('defaults new connections to OAuth (app)', () => {
    expect(emptyAtlassianConnectionForm().authType).toBe('app');
  });

  describe('validateAtlassianConnectionForm', () => {
    it('requires base URL, client id and client secret for app connections on create', () => {
      expect(validateAtlassianConnectionForm(emptyAtlassianConnectionForm(), null)).toEqual({
        baseUrl: 'required',
        oauthClientId: 'required',
        oauthClientSecret: 'required',
      });
    });

    it('requires email + API token for token connections and validates formats', () => {
      const form = { ...emptyAtlassianConnectionForm('token'), baseUrl: 'site.atlassian.net', accountEmail: 'nope' };

      expect(validateAtlassianConnectionForm(form, null)).toEqual({
        baseUrl: 'url',
        accountEmail: 'email',
        apiToken: 'required',
      });
    });

    it('keeps stored secrets on edit without switching, requires them when switching', () => {
      const form = { ...emptyAtlassianConnectionForm('app'), baseUrl: 'https://x.atlassian.net', oauthClientId: 'cid' };

      expect(hasAtlassianConnectionFormErrors(validateAtlassianConnectionForm(form, 'app'))).toBe(false);
      expect(validateAtlassianConnectionForm(form, 'token')).toEqual({ oauthClientSecret: 'required' });
    });
  });

  it('builds create payloads with only the selected credentials', () => {
    const form = {
      ...emptyAtlassianConnectionForm('app'),
      label: '  ',
      baseUrl: ' https://x.atlassian.net ',
      oauthClientId: ' cid ',
      oauthClientSecret: 'sec',
      accountEmail: 'stale@b.com',
      apiToken: 'stale',
    };

    expect(toCreateAtlassianConnectionDto(form)).toEqual({
      label: undefined,
      baseUrl: 'https://x.atlassian.net',
      authType: 'app',
      oauthClientId: 'cid',
      oauthClientSecret: 'sec',
    });
  });

  it('omits empty secrets from update payloads', () => {
    const form = {
      ...emptyAtlassianConnectionForm('token'),
      label: 'L',
      baseUrl: 'https://x.atlassian.net',
      accountEmail: 'a@b.com',
    };

    expect(toUpdateAtlassianConnectionDto(form)).toEqual({
      label: 'L',
      baseUrl: 'https://x.atlassian.net',
      authType: 'token',
      accountEmail: 'a@b.com',
    });
    expect(toUpdateAtlassianConnectionDto({ ...form, apiToken: ' t ' }).apiToken).toBe('t');
  });
});
