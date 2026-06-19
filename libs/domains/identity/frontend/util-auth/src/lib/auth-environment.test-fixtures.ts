import type { AuthMarketing } from '@forepath/shared/frontend/util-configuration';

import type { IdentityAuthEnvironment } from './auth-environment';

const defaultAuthMarketing: AuthMarketing = {
  loginDescription: 'Test login description',
  registerDescription: 'Test register description',
  requestPasswordResetDescription: 'Test password reset request description',
  resetPasswordConfirmationDescription: 'Test password reset confirmation description',
  resetPasswordDescription: 'Test password reset description',
  confirmEmailDescription: 'Test email confirmation description',
  features: [{ title: 'Test feature', description: 'Test feature description' }],
};

export function createMockIdentityAuthEnvironment(
  overrides: Partial<IdentityAuthEnvironment> = {},
): IdentityAuthEnvironment {
  return {
    productName: 'Agenstra',
    authMarketing: defaultAuthMarketing,
    apiUrl: 'http://localhost:3100/api',
    authentication: { type: 'api-key' },
    ...overrides,
  };
}
