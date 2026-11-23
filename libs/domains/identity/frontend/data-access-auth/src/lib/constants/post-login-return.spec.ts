import {
  consumePostLoginReturnUrl,
  isAllowedConsoleReturnUrl,
  isAllowedPostLoginReturnUrl,
  POST_LOGIN_RETURN_URL_STORAGE_KEY,
  storeConsoleReturnUrl,
  storePostLoginReturnUrl,
} from './auth-error.constants';

describe('post-login return URL', () => {
  beforeEach(() => sessionStorage.clear());

  it.each(['/authorize?app_id=1&state=a', '/authorize'])('allows the grant page %s', (url) => {
    expect(isAllowedPostLoginReturnUrl(url)).toBe(true);
  });

  it.each([
    'https://evil.example.com/authorize',
    '//evil.example.com/authorize',
    '/clients',
    '/authorize-evil',
    '/authorize?x=1#frag',
    '/authorize?x=\\evil',
    null,
  ])('rejects %s', (url) => {
    expect(isAllowedPostLoginReturnUrl(url)).toBe(false);
  });

  it('stores, consumes once and clears', () => {
    storePostLoginReturnUrl('/authorize?app_id=1');

    expect(consumePostLoginReturnUrl()).toBe('/authorize?app_id=1');
    expect(consumePostLoginReturnUrl()).toBeNull();
  });

  it('ignores disallowed URLs and expired entries', () => {
    storePostLoginReturnUrl('https://evil.example.com');
    expect(sessionStorage.getItem(POST_LOGIN_RETURN_URL_STORAGE_KEY)).toBeNull();

    sessionStorage.setItem(
      POST_LOGIN_RETURN_URL_STORAGE_KEY,
      JSON.stringify({ url: '/authorize?app_id=1', at: Date.now() - 31 * 60 * 1000 }),
    );
    expect(consumePostLoginReturnUrl()).toBeNull();

    // Tampered storage: only the grant page or a safe console path is ever resumed.
    sessionStorage.setItem(
      POST_LOGIN_RETURN_URL_STORAGE_KEY,
      JSON.stringify({ url: '//evil.example.com/x', at: Date.now() }),
    );
    expect(consumePostLoginReturnUrl()).toBeNull();
  });

  describe('console deep links', () => {
    it.each(['/clients', '/tickets/c1?ticket=t1', '/administration/overview?f=groupBy%3Dmonth', '/overview/c1'])(
      'allows %s',
      (url) => {
        expect(isAllowedConsoleReturnUrl(url)).toBe(true);
      },
    );

    it.each([
      '/',
      '',
      'https://evil.example.com/clients',
      '//evil.example.com/clients',
      '/\\evil.example.com',
      '/clients\\x',
      '/clients#frag',
      '/clients\u0000x',
      'javascript:alert(1)',
      '/login',
      '/login?returnUrl=/x',
      '/login-2fa',
      '/register',
      '/reset-password?code=1',
      '/authorize?app_id=1',
      `/${'a'.repeat(2100)}`,
      null,
    ])('rejects %s', (url) => {
      expect(isAllowedConsoleReturnUrl(url)).toBe(false);
    });

    it('stores and consumes a console deep link once', () => {
      storeConsoleReturnUrl('/tickets/c1');

      expect(consumePostLoginReturnUrl()).toBe('/tickets/c1');
      expect(consumePostLoginReturnUrl()).toBeNull();
    });

    it('ignores unsafe console URLs', () => {
      storeConsoleReturnUrl('//evil.example.com');

      expect(sessionStorage.getItem(POST_LOGIN_RETURN_URL_STORAGE_KEY)).toBeNull();
    });

    it('keeps the grant page allowlist strict', () => {
      expect(isAllowedPostLoginReturnUrl('/clients')).toBe(false);
    });
  });
});
