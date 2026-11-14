import {
  CloudInitServiceType,
  IntegratedProvisioningService,
  canonicalizeCloudInitService,
  canonicalizeIntegratedProvisioningService,
  integratedProvisioningServiceLabel,
  rewriteIntegratedServiceIdsInConfig,
} from './integrated-provisioning-service';

describe('integrated-provisioning-service', () => {
  describe('canonicalizeIntegratedProvisioningService', () => {
    it('returns canonical ids unchanged', () => {
      expect(canonicalizeIntegratedProvisioningService(IntegratedProvisioningService.AgenstraController)).toBe(
        IntegratedProvisioningService.AgenstraController,
      );
      expect(canonicalizeIntegratedProvisioningService(IntegratedProvisioningService.AgenstraManager)).toBe(
        IntegratedProvisioningService.AgenstraManager,
      );
      expect(canonicalizeIntegratedProvisioningService(IntegratedProvisioningService.DecabillBilling)).toBe(
        IntegratedProvisioningService.DecabillBilling,
      );
    });

    it('maps legacy aliases', () => {
      expect(canonicalizeIntegratedProvisioningService('controller')).toBe(
        IntegratedProvisioningService.AgenstraController,
      );
      expect(canonicalizeIntegratedProvisioningService('manager')).toBe(IntegratedProvisioningService.AgenstraManager);
    });

    it('returns null for unknown values', () => {
      expect(canonicalizeIntegratedProvisioningService('')).toBeNull();
      expect(canonicalizeIntegratedProvisioningService('other')).toBeNull();
    });
  });

  describe('canonicalizeCloudInitService', () => {
    it('maps integrated, custom, and legacy values', () => {
      expect(canonicalizeCloudInitService('agenstra-manager')).toBe(CloudInitServiceType.AgenstraManager);
      expect(canonicalizeCloudInitService('decabill-billing')).toBe(CloudInitServiceType.DecabillBilling);
      expect(canonicalizeCloudInitService('custom')).toBe(CloudInitServiceType.Custom);
      expect(canonicalizeCloudInitService('none')).toBe(CloudInitServiceType.None);
      expect(canonicalizeCloudInitService('controller')).toBe(CloudInitServiceType.AgenstraController);
      expect(canonicalizeCloudInitService('manager')).toBe(CloudInitServiceType.AgenstraManager);
      expect(canonicalizeCloudInitService(undefined)).toBe(CloudInitServiceType.AgenstraController);
    });
  });

  describe('integratedProvisioningServiceLabel', () => {
    it('returns labels for all integrated services', () => {
      expect(integratedProvisioningServiceLabel(IntegratedProvisioningService.AgenstraController)).toBe(
        'Agenstra Controller',
      );
      expect(integratedProvisioningServiceLabel(IntegratedProvisioningService.AgenstraManager)).toBe(
        'Agenstra Manager',
      );
      expect(integratedProvisioningServiceLabel(IntegratedProvisioningService.DecabillBilling)).toBe(
        'Decabill Billing',
      );
    });
  });

  describe('rewriteIntegratedServiceIdsInConfig', () => {
    it('rewrites service, option key, and provisioningOptions to canonical ids', () => {
      const { changed, config } = rewriteIntegratedServiceIdsInConfig(
        {
          service: 'controller',
          provisioningOptionKey: 'integrated:manager',
          provisioningOptions: [
            { type: 'integrated', service: 'controller' },
            { type: 'integrated', service: 'manager' },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
          ],
          region: 'fsn1',
        },
        'toCanonical',
      );

      expect(changed).toBe(true);
      expect(config).toEqual({
        service: 'agenstra-controller',
        provisioningOptionKey: 'integrated:agenstra-manager',
        provisioningOptions: [
          { type: 'integrated', service: 'agenstra-controller' },
          { type: 'integrated', service: 'agenstra-manager' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
        region: 'fsn1',
      });
    });

    it('is a no-op when already canonical', () => {
      const input = {
        service: 'agenstra-controller',
        provisioningOptions: [{ type: 'integrated', service: 'agenstra-manager' }],
      };
      const { changed, config } = rewriteIntegratedServiceIdsInConfig(input, 'toCanonical');

      expect(changed).toBe(false);
      expect(config).toEqual(input);
    });

    it('rewrites canonical ids back to legacy on toLegacy', () => {
      const { changed, config } = rewriteIntegratedServiceIdsInConfig(
        {
          service: 'agenstra-manager',
          provisioningOptionKey: 'integrated:agenstra-controller',
        },
        'toLegacy',
      );

      expect(changed).toBe(true);
      expect(config).toEqual({
        service: 'manager',
        provisioningOptionKey: 'integrated:controller',
      });
    });
  });
});
