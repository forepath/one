import type { IdentityAuthEnvironment } from './auth-environment';

export function createMockIdentityAuthEnvironment(
  overrides: Partial<IdentityAuthEnvironment> = {},
): IdentityAuthEnvironment {
  return {
    productName: 'Agenstra',
    apiUrl: 'http://localhost:3100/api',
    authentication: { type: 'api-key' },
    ...overrides,
  };
}
