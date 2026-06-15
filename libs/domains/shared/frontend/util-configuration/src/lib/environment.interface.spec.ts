import {
  ApiKeyAuthenticationConfig,
  AuthenticationConfig,
  Environment,
  KeycloakAuthenticationConfig,
} from './environment.interface';

describe('Environment interfaces', () => {
  describe('Environment', () => {
    it('should require production property', () => {
      const validEnv: Environment = {
        production: true,
        controller: {
          restApiUrl: 'http://localhost:3100/api',
          websocketUrl: 'ws://localhost:8081/clients',
        },
        billing: {
          restApiUrl: 'http://localhost:3200/api',
          frontendUrl: 'http://localhost:4500',
        },
        authentication: {
          type: 'api-key',
        },
        chatModelOptions: {
          cursor: {
            'composer-1': 'Composer 1',
          },
          opencode: {
            'gpt-4o': 'GPT-4o',
          },
        },
        editor: {
          openInNewWindow: false,
        },
        deployment: {
          openInNewWindow: false,
        },
        cookieConsent: {
          domain: 'localhost',
          privacyPolicyUrl: 'https://example.com/privacy',
          termsUrl: 'https://example.com/terms',
        },
      };

      expect(validEnv.production).toBe(true);
    });

    it('should require authentication property', () => {
      const validEnv: Environment = {
        production: false,
        controller: {
          restApiUrl: 'http://localhost:3100/api',
          websocketUrl: 'ws://localhost:8081/clients',
        },
        billing: {
          restApiUrl: 'http://localhost:3200/api',
          frontendUrl: 'http://localhost:4500',
        },
        authentication: {
          type: 'api-key',
        },
        chatModelOptions: {
          cursor: {
            'composer-1': 'Composer 1',
          },
          opencode: {
            'gpt-4o': 'GPT-4o',
          },
        },
        editor: {
          openInNewWindow: false,
        },
        deployment: {
          openInNewWindow: false,
        },
        cookieConsent: {
          domain: 'localhost',
          privacyPolicyUrl: 'https://example.com/privacy',
          termsUrl: 'https://example.com/terms',
        },
      };

      expect(validEnv.authentication).toBeDefined();
      expect(validEnv.authentication.type).toBe('api-key');
    });

    it('should allow optional controller property', () => {
      const envWithController: Environment = {
        production: false,
        controller: {
          restApiUrl: 'http://localhost:3100/api',
          websocketUrl: 'ws://localhost:8081/clients',
        },
        billing: {
          restApiUrl: 'http://localhost:3200/api',
          frontendUrl: 'http://localhost:4500',
        },
        authentication: {
          type: 'api-key',
        },
        chatModelOptions: {
          cursor: {
            'composer-1': 'Composer 1',
          },
          opencode: {
            'gpt-4o': 'GPT-4o',
          },
        },
        editor: {
          openInNewWindow: false,
        },
        deployment: {
          openInNewWindow: false,
        },
        cookieConsent: {
          domain: 'localhost',
          privacyPolicyUrl: 'https://example.com/privacy',
          termsUrl: 'https://example.com/terms',
        },
      };

      expect(envWithController.controller).toBeDefined();
      expect(envWithController.controller?.restApiUrl).toBe('http://localhost:3100/api');
      expect(envWithController.controller?.websocketUrl).toBe('ws://localhost:8081/clients');
    });

    it('should require chatModelOptions map', () => {
      const env: Environment = {
        production: true,
        controller: {
          restApiUrl: 'http://localhost:3100/api',
          websocketUrl: 'ws://localhost:8081/clients',
        },
        billing: {
          restApiUrl: 'http://localhost:3200/api',
          frontendUrl: 'http://localhost:4500',
        },
        authentication: {
          type: 'api-key',
        },
        chatModelOptions: {
          cursor: {
            'composer-1': 'Composer 1',
          },
          opencode: {
            'gpt-4o': 'GPT-4o',
          },
        },
        editor: {
          openInNewWindow: false,
        },
        deployment: {
          openInNewWindow: false,
        },
        cookieConsent: {
          domain: 'localhost',
          privacyPolicyUrl: 'https://example.com/privacy',
          termsUrl: 'https://example.com/terms',
        },
      };

      expect(env.chatModelOptions).toBeDefined();
      Object.entries(env.chatModelOptions).forEach(([key, value]) => {
        expect(typeof key).toBe('string');
        expect(typeof value).toBe('object');
        expect(value).not.toBeNull();
        // Each value should be a Record<string, string>
        Object.entries(value).forEach(([innerKey, innerValue]) => {
          expect(typeof innerKey).toBe('string');
          expect(typeof innerValue).toBe('string');
        });
      });
    });
  });

  describe('ApiKeyAuthenticationConfig', () => {
    it('should have type "api-key"', () => {
      const config: ApiKeyAuthenticationConfig = {
        type: 'api-key',
      };

      expect(config.type).toBe('api-key');
    });

    it('should allow optional apiKey property', () => {
      const configWithoutKey: ApiKeyAuthenticationConfig = {
        type: 'api-key',
      };

      expect(configWithoutKey.apiKey).toBeUndefined();

      const configWithKey: ApiKeyAuthenticationConfig = {
        type: 'api-key',
        apiKey: 'test-api-key',
      };

      expect(configWithKey.apiKey).toBe('test-api-key');
    });
  });

  describe('KeycloakAuthenticationConfig', () => {
    it('should have type "keycloak"', () => {
      const config: KeycloakAuthenticationConfig = {
        type: 'keycloak',
        authServerUrl: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client',
      };

      expect(config.type).toBe('keycloak');
    });

    it('should require authServerUrl', () => {
      const config: KeycloakAuthenticationConfig = {
        type: 'keycloak',
        authServerUrl: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client',
      };

      expect(config.authServerUrl).toBe('https://keycloak.example.com');
    });

    it('should require realm', () => {
      const config: KeycloakAuthenticationConfig = {
        type: 'keycloak',
        authServerUrl: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client',
      };

      expect(config.realm).toBe('test-realm');
    });

    it('should require clientId', () => {
      const config: KeycloakAuthenticationConfig = {
        type: 'keycloak',
        authServerUrl: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client',
      };

      expect(config.clientId).toBe('test-client');
    });
  });

  describe('AuthenticationConfig union type', () => {
    it('should accept ApiKeyAuthenticationConfig', () => {
      const apiKeyConfig: AuthenticationConfig = {
        type: 'api-key',
      };

      expect(apiKeyConfig.type).toBe('api-key');
    });

    it('should accept KeycloakAuthenticationConfig', () => {
      const keycloakConfig: AuthenticationConfig = {
        type: 'keycloak',
        authServerUrl: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client',
      };

      expect(keycloakConfig.type).toBe('keycloak');
    });

    it('should allow type narrowing', () => {
      const config: AuthenticationConfig = {
        type: 'api-key',
      };

      if (config.type === 'api-key') {
        // TypeScript should narrow to ApiKeyAuthenticationConfig
        expect(config.type).toBe('api-key');
        // apiKey is optional, so this should compile
        const apiKey = config.apiKey;

        expect(apiKey).toBeUndefined();
      }
    });

    it('should allow type narrowing for keycloak', () => {
      const config: AuthenticationConfig = {
        type: 'keycloak',
        authServerUrl: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client',
      };

      if (config.type === 'keycloak') {
        // TypeScript should narrow to KeycloakAuthenticationConfig
        expect(config.type).toBe('keycloak');
        expect(config.authServerUrl).toBe('https://keycloak.example.com');
        expect(config.realm).toBe('test-realm');
        expect(config.clientId).toBe('test-client');
      }
    });
  });
});
