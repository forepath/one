import {
  buildOrderAuthProviderConfig,
  buildPlanOrderRequestedConfig,
  createDefaultIntegratedOrderConfig,
  createDefaultOidcOrderConfig,
  createDefaultSamlOrderConfig,
  isOrderAuthMethodSupported,
} from './plan-order-requested-config.util';

const baseParams = {
  customOrderFields: [],
  customEnv: {},
  provisioningOptionKey: '',
  showProvisioningPicker: false,
  provisioningProvider: '',
  hasProviderSelection: false,
  geographyFieldKey: null,
  provisioningLocation: '',
  provisioningServerType: '',
};

describe('plan-order-requested-config auth helpers', () => {
  it('limits agent-manager instances to api-key and oidc', () => {
    expect(isOrderAuthMethodSupported('agenstra-manager', 'api-key')).toBe(true);
    expect(isOrderAuthMethodSupported('agenstra-manager', 'oidc')).toBe(true);
    expect(isOrderAuthMethodSupported('agenstra-manager', 'saml')).toBe(false);
    expect(isOrderAuthMethodSupported('agenstra-manager', 'users')).toBe(false);
    expect(isOrderAuthMethodSupported('agenstra-controller', 'saml')).toBe(true);
    expect(isOrderAuthMethodSupported('decabill-billing', 'users')).toBe(true);
  });

  it('builds the oidc object with required fields and trimmed optional ones', () => {
    const oidc = {
      ...createDefaultOidcOrderConfig(),
      issuer: ' https://idp.example.com/realms/x ',
      clientId: 'api',
      frontendClientId: 'console',
    };

    expect(
      buildOrderAuthProviderConfig({ authenticationMethod: 'oidc', oidc, saml: createDefaultSamlOrderConfig() }),
    ).toEqual({
      oidc: {
        issuer: 'https://idp.example.com/realms/x',
        clientId: 'api',
        clientSecret: '',
        frontendClientId: 'console',
      },
    });
  });

  it('builds the saml object', () => {
    const saml = { ...createDefaultSamlOrderConfig(), idpSsoUrl: 'https://idp/sso', idpCert: 'PEM', idpIssuer: 'idp' };

    expect(
      buildOrderAuthProviderConfig({ authenticationMethod: 'saml', oidc: createDefaultOidcOrderConfig(), saml }),
    ).toEqual({
      saml: { idpSsoUrl: 'https://idp/sso', idpCert: 'PEM', idpIssuer: 'idp' },
    });
  });

  it('adds no provider object for users / api-key and never sends keycloak', () => {
    const integrated = { ...createDefaultIntegratedOrderConfig(), authenticationMethod: 'users' as const };
    const config = buildPlanOrderRequestedConfig({ ...baseParams, integrated });

    expect(config['oidc']).toBeUndefined();
    expect(config['saml']).toBeUndefined();
    expect(config['keycloak']).toBeUndefined();
  });

  it('includes the oidc object in the requested config', () => {
    const integrated = {
      ...createDefaultIntegratedOrderConfig(),
      authenticationMethod: 'oidc' as const,
      oidc: { ...createDefaultOidcOrderConfig(), issuer: 'https://idp', clientId: 'api', clientSecret: 's' },
    };
    const config = buildPlanOrderRequestedConfig({ ...baseParams, integrated });

    expect(config['authenticationMethod']).toBe('oidc');
    expect(config['oidc']).toEqual({ issuer: 'https://idp', clientId: 'api', clientSecret: 's' });
  });
});
