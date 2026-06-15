import { environment } from './environment';
import { Environment } from './environment.interface';

describe('environment', () => {
  it('should be defined', () => {
    expect(environment).toBeDefined();
  });

  it('should be an instance of Environment', () => {
    expect(environment).toMatchObject<Environment>({
      production: expect.any(Boolean),
      controller: expect.any(Object),
      billing: expect.any(Object),
      authentication: expect.any(Object),
      chatModelOptions: expect.any(Object),
      editor: expect.any(Object),
      deployment: expect.any(Object),
      cookieConsent: expect.any(Object),
    });
  });

  it('should have production property', () => {
    expect(environment).toHaveProperty('production');
    expect(typeof environment.production).toBe('boolean');
  });

  it('should have authentication property', () => {
    expect(environment).toHaveProperty('authentication');
    expect(environment.authentication).toBeDefined();
  });

  it('should have chatModelOptions property with string mappings', () => {
    expect(environment).toHaveProperty('chatModelOptions');
    expect(environment.chatModelOptions).toBeDefined();
    expect(typeof environment.chatModelOptions).toBe('object');
    Object.entries(environment.chatModelOptions).forEach(([key, value]) => {
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

  it('should have authentication type property', () => {
    expect(environment.authentication).toHaveProperty('type');
    expect(['keycloak', 'api-key', 'users']).toContain(environment.authentication.type);
  });

  describe('when authentication type is api-key', () => {
    it('should have api-key authentication config', () => {
      if (environment.authentication.type === 'api-key') {
        expect(environment.authentication).toMatchObject({
          type: 'api-key',
        });

        // apiKey is optional
        if ('apiKey' in environment.authentication) {
          expect(typeof environment.authentication.apiKey).toBe('string');
        }
      }
    });
  });

  describe('when authentication type is keycloak', () => {
    it('should have keycloak authentication config', () => {
      if (environment.authentication.type === 'keycloak') {
        expect(environment.authentication).toMatchObject({
          type: 'keycloak',
          authServerUrl: expect.any(String),
          realm: expect.any(String),
          clientId: expect.any(String),
        });
      }
    });
  });

  describe('when controller is defined', () => {
    it('should have controller with restApiUrl and websocketUrl', () => {
      if (environment.controller) {
        expect(environment.controller).toMatchObject({
          restApiUrl: expect.any(String),
          websocketUrl: expect.any(String),
        });
        expect(environment.controller.restApiUrl).toBeTruthy();
        expect(environment.controller.websocketUrl).toBeTruthy();
      }
    });
  });

  describe('when cookieConsent is defined', () => {
    it('should have cookieConsent with domain', () => {
      if (environment.cookieConsent) {
        expect(environment.cookieConsent).toMatchObject({
          domain: expect.any(String),
          privacyPolicyUrl: expect.any(String),
        });
      }
    });
  });
});
