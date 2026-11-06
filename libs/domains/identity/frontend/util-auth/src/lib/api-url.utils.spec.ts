import { isUrlWithinApiBase } from './api-url.utils';

describe('isUrlWithinApiBase', () => {
  it.each([
    ['https://api.example.com/api/clients', 'https://api.example.com/api', true],
    ['https://api.example.com/api', 'https://api.example.com/api/', true],
    ['https://api.example.com/api?x=1', 'https://api.example.com/api', true],
    ['https://api.example.com/other', 'https://api.example.com', true],
    ['https://api.example.com.evil.tld/api/clients', 'https://api.example.com', false],
    ['https://api.example.com.evil.tld/api/clients', 'https://api.example.com/api', false],
    ['https://api.example.com/apix/clients', 'https://api.example.com/api', false],
    ['http://api.example.com/api/clients', 'https://api.example.com/api', false],
    ['https://api.example.com:8443/api/clients', 'https://api.example.com/api', false],
    ['https://user@api.example.com.evil.tld/api', 'https://api.example.com/api', false],
    ['https://api.example.com/api/x', '', false],
  ])('%s within %s → %s', (url, base, expected) => {
    expect(isUrlWithinApiBase(url, base)).toBe(expected);
  });
});
