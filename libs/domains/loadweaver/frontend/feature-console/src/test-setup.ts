import '@angular/localize/init';
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

// Keycloak ships ES modules only; the console's data-access imports it for socket credentials.
jest.mock('keycloak-js', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn((impl: unknown) => impl),
}));

setupZoneTestEnv();

// jsdom has no matchMedia (the summary bar watches breakpoints).
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// The shared libs pull in xterm, which probes a canvas on import; jsdom has none.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { writable: true, value: () => null });
}
