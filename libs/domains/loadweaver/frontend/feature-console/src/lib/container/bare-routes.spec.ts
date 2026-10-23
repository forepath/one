import { isBareRoute } from './container.component';

describe('isBareRoute', () => {
  it('shows sign-in flows and the kiosk without the chrome', () => {
    expect(isBareRoute('/login')).toBe(true);
    expect(isBareRoute('/de/request-password-reset')).toBe(true);
    expect(isBareRoute('/en/request-password-reset-confirmation?email=x')).toBe(true);
    expect(isBareRoute('/kiosk/abc')).toBe(true);
    expect(isBareRoute('/overview')).toBe(false);
    expect(isBareRoute('/de/login-history')).toBe(false);
  });
});
