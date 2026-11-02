import { kioskUrl, tokenFromHash, wallboardScopeLabel } from './wallboard-format';

const token = `lw_wb_${'a'.repeat(43)}`;

describe('wallboard format', () => {
  it('puts the token into the kiosk URL’s fragment', () => {
    expect(kioskUrl('https://console.example.com/', token)).toBe(`https://console.example.com/kiosk#${token}`);
    expect(kioskUrl('https://console.example.com/de/', token)).toBe(`https://console.example.com/de/kiosk#${token}`);
  });

  it('reads only well-formed tokens from the hash', () => {
    expect(tokenFromHash(`#${token}`)).toBe(token);
    expect(tokenFromHash(`#${encodeURIComponent(token)}`)).toBe(token);
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#lw_wb_short')).toBeNull();
    expect(tokenFromHash('#%E0%A4%A')).toBeNull();
  });

  it('labels the scope', () => {
    expect(wallboardScopeLabel({ projects: null })).toBe('Whole cluster');
    expect(wallboardScopeLabel({ projects: ['shop', 'web'] })).toBe('shop, web');
  });
});
