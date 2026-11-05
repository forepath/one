import {
  consumePostLoginReturnUrl,
  isAllowedPostLoginReturnUrl,
  POST_LOGIN_RETURN_URL_STORAGE_KEY,
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

    sessionStorage.setItem(POST_LOGIN_RETURN_URL_STORAGE_KEY, JSON.stringify({ url: '/clients', at: Date.now() }));
    expect(consumePostLoginReturnUrl()).toBeNull();
  });
});
