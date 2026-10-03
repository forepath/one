import { InjectionToken } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { BaseEnvironment } from './environment.interface';
import {
  ENVIRONMENT,
  RUNTIME_CONFIG_ELEMENT_ID,
  createLoadRuntimeEnvironment,
  mergeEnvironmentOverrides,
  RUNTIME_CONFIG_CLIENT_FETCH_TIMEOUT_MS,
} from './environment.token';

const baseEnvironment: BaseEnvironment = {
  application: {
    production: false,
    productName: 'Test',
  },
  authentication: {
    config: { type: 'users', disableSignup: false, disableForceLogin2fa: false },
    marketing: {
      loginDescription: 'login',
      registerDescription: 'register',
      requestPasswordResetDescription: 'request',
      resetPasswordConfirmationDescription: 'confirm-reset',
      resetPasswordDescription: 'reset',
      confirmEmailDescription: 'confirm',
      features: [],
    },
  },
  cookieConsent: {
    enabled: true,
    domain: 'localhost',
    urls: {
      privacyPolicy: 'https://example.com/privacy',
      terms: 'https://example.com/terms',
    },
  },
  socialPreview: {
    urls: {
      image: 'https://example.com/og.png',
    },
  },
};

describe('environment.token', () => {
  describe('ENVIRONMENT', () => {
    it('should be an InjectionToken', () => {
      expect(ENVIRONMENT).toBeInstanceOf(InjectionToken);
    });
  });

  describe('mergeEnvironmentOverrides', () => {
    it('deep-merges nested application and authentication bags', () => {
      const merged = mergeEnvironmentOverrides(baseEnvironment, {
        application: { productName: 'Merged' },
        authentication: {
          config: { type: 'api-key' },
        },
      });

      expect(merged.application.productName).toBe('Merged');
      expect(merged.application.production).toBe(false);
      expect(merged.authentication.config.type).toBe('api-key');
      expect(merged.authentication.marketing.loginDescription).toBe('login');
    });

    it('overlays role-split remote JSON onto billing and landing bases', () => {
      /** Mirrors configs/<domain>/billing.json and landingpage.json (separate CONFIG URLs). */
      const billingRemoteConfig = {
        application: { production: true },
        billing: {
          tenantId: 'acme',
          urls: {
            restApi: 'https://backend.example/api',
            websocket: 'https://backend.example/socket/billing',
          },
        },
      };
      const landingRemoteConfig = {
        application: { production: true },
        landing: {
          tenantId: 'acme',
          urls: {
            restApi: 'https://backend.example/api',
            portal: 'https://portal.example',
          },
        },
      };

      type BillingEnv = BaseEnvironment & {
        billing: {
          tenantId?: string;
          urls: { restApi: string; frontend?: string; websocket: string };
        };
      };
      type LandingEnv = BaseEnvironment & {
        landing: {
          tenantId?: string;
          urls: { restApi?: string; portal: string };
        };
      };

      const billingBase: BillingEnv = {
        ...baseEnvironment,
        billing: {
          urls: {
            restApi: 'http://localhost:3200/api',
            frontend: 'http://localhost:4500',
            websocket: 'http://localhost:3200/socket/billing',
          },
        },
      };
      const landingBase: LandingEnv = {
        ...baseEnvironment,
        landing: {
          urls: {
            restApi: 'http://localhost:3200/api',
            portal: 'http://localhost:4500',
          },
        },
      };

      const billingMerged = mergeEnvironmentOverrides(billingBase, billingRemoteConfig as Partial<BillingEnv>);
      const landingMerged = mergeEnvironmentOverrides(landingBase, landingRemoteConfig as Partial<LandingEnv>);

      expect(billingMerged.application.production).toBe(true);
      expect(billingMerged.billing.tenantId).toBe('acme');
      expect(billingMerged.billing.urls.restApi).toBe('https://backend.example/api');
      expect(billingMerged.billing.urls.websocket).toBe('https://backend.example/socket/billing');
      expect(billingMerged.billing.urls.frontend).toBe('http://localhost:4500');

      expect(landingMerged.application.production).toBe(true);
      expect(landingMerged.landing.tenantId).toBe('acme');
      expect(landingMerged.landing.urls.portal).toBe('https://portal.example');
    });
  });

  describe('createLoadRuntimeEnvironment', () => {
    const loadRuntimeEnvironment = createLoadRuntimeEnvironment(baseEnvironment);

    beforeEach(() => {
      global.fetch = jest.fn();
      document.body.replaceChildren();
    });

    afterEach(() => {
      jest.restoreAllMocks();
      document.body.replaceChildren();
    });

    it('prefers inlined #runtime-config and skips fetch', async () => {
      const script = document.createElement('script');

      script.type = 'application/json';
      script.id = RUNTIME_CONFIG_ELEMENT_ID;
      script.textContent = JSON.stringify({
        application: { productName: 'Inline' },
      });
      document.body.appendChild(script);

      const result = await loadRuntimeEnvironment();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.application.productName).toBe('Inline');
      expect(result.application.production).toBe(false);
    });

    it('should return environment when fetch fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await loadRuntimeEnvironment();

      expect(result).toBe(baseEnvironment);
    });

    it('should call /config endpoint with timeout', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await loadRuntimeEnvironment();

      expect(global.fetch).toHaveBeenCalledWith('/config', {
        signal: expect.any(AbortSignal),
      });
      expect(timeoutSpy).toHaveBeenCalledWith(RUNTIME_CONFIG_CLIENT_FETCH_TIMEOUT_MS);
      timeoutSpy.mockRestore();
    });
  });

  describe('ENVIRONMENT injection', () => {
    it('should be injectable via useValue provider', async () => {
      await TestBed.configureTestingModule({
        providers: [
          {
            provide: ENVIRONMENT,
            useValue: baseEnvironment,
          },
        ],
      }).compileComponents();

      const injected = TestBed.inject(ENVIRONMENT);

      expect(injected).toBe(baseEnvironment);
      expect(injected.application.productName).toBe('Test');
    });
  });
});
