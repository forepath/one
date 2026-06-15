import { InjectionToken } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { environment } from './environment';
import { Environment } from './environment.interface';
import { ENVIRONMENT, loadRuntimeEnvironment } from './environment.token';

describe('environment.token', () => {
  describe('ENVIRONMENT', () => {
    it('should be an InjectionToken', () => {
      expect(ENVIRONMENT).toBeInstanceOf(InjectionToken);
    });

    it('should be typed as InjectionToken<Environment>', () => {
      // Type check: token should accept Environment type
      const testProvider = {
        provide: ENVIRONMENT,
        useValue: environment,
      };

      expect(testProvider.provide).toBe(ENVIRONMENT);
      expect(testProvider.useValue).toBeDefined();
    });
  });

  describe('loadRuntimeEnvironment', () => {
    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return environment when fetch fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await loadRuntimeEnvironment();

      expect(result).toBe(environment);
    });

    it('should return environment when response is not ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await loadRuntimeEnvironment();

      expect(result).toBe(environment);
    });

    it('should merge remote config with base environment', async () => {
      const remoteConfig: Partial<Environment> = {
        controller: {
          restApiUrl: 'http://custom-api:3000/api',
          websocketUrl: 'http://custom-ws:8080/clients',
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => remoteConfig,
      });

      const result = await loadRuntimeEnvironment();

      expect(result.controller.restApiUrl).toBe('http://custom-api:3000/api');
      expect(result.controller.websocketUrl).toBe('http://custom-ws:8080/clients');
      // Other properties should remain from base environment
      expect(result.production).toBe(environment.production);
    });

    it('should call /config endpoint', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await loadRuntimeEnvironment();
      expect(global.fetch).toHaveBeenCalledWith('/config');
    });
  });

  describe('ENVIRONMENT injection', () => {
    it('should be injectable via useValue provider', async () => {
      await TestBed.configureTestingModule({
        providers: [
          {
            provide: ENVIRONMENT,
            useValue: environment,
          },
        ],
      }).compileComponents();

      const injected = TestBed.inject(ENVIRONMENT);

      expect(injected).toBe(environment);
      expect(injected).toMatchObject<Environment>({
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

    it('should provide same instance on multiple injections', async () => {
      await TestBed.configureTestingModule({
        providers: [
          {
            provide: ENVIRONMENT,
            useValue: environment,
          },
        ],
      }).compileComponents();

      const first = TestBed.inject(ENVIRONMENT);
      const second = TestBed.inject(ENVIRONMENT);

      expect(first).toBe(second);
      expect(first).toBe(environment);
    });

    it('should allow injection in service', async () => {
      class TestService {
        constructor(public env: Environment) {}
      }

      await TestBed.configureTestingModule({
        providers: [
          {
            provide: ENVIRONMENT,
            useValue: environment,
          },
          {
            provide: TestService,
            useFactory: (env: Environment) => new TestService(env),
            deps: [ENVIRONMENT],
          },
        ],
      }).compileComponents();

      const service = TestBed.inject(TestService);

      expect(service.env).toBe(environment);
      expect(service.env).toMatchObject<Environment>({
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
  });
});
