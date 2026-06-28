import { CloudInitConfigEntity } from '../../entities/cloud-init-config.entity';
import { buildProvisioningUserData, normalizeCloudInitService } from './cloud-init-dispatch.utils';

jest.mock('./agent-controller.utils', () => ({
  buildCloudInitConfigFromRequest: jest.fn().mockReturnValue({ host: {} }),
  buildBillingCloudInitUserData: jest.fn().mockReturnValue('controller-user-data'),
}));

jest.mock('./agent-manager.utils', () => ({
  buildAgentManagerCloudInitConfigFromRequest: jest.fn().mockReturnValue({ host: {} }),
  buildAgentManagerCloudInitUserData: jest.fn().mockReturnValue('manager-user-data'),
}));

jest.mock('./custom-configuration.utils', () => ({
  buildCustomConfigurationCloudInitConfigFromRequest: jest.fn().mockReturnValue({ app: {} }),
  buildCustomConfigurationCloudInitUserData: jest.fn().mockReturnValue('custom-user-data'),
}));

describe('cloud-init-dispatch.utils', () => {
  describe('normalizeCloudInitService', () => {
    it('returns manager and custom when specified', () => {
      expect(normalizeCloudInitService('manager')).toBe('manager');
      expect(normalizeCloudInitService('custom')).toBe('custom');
    });

    it('defaults to controller for unknown values', () => {
      expect(normalizeCloudInitService(undefined)).toBe('controller');
      expect(normalizeCloudInitService('other')).toBe('controller');
    });
  });

  describe('buildProvisioningUserData', () => {
    const baseParams = {
      effectiveConfig: { service: 'controller' },
      hostname: 'host1',
      baseDomain: 'spirde.com',
    };

    it('builds controller user data by default', () => {
      expect(buildProvisioningUserData({ ...baseParams, service: 'controller' })).toBe('controller-user-data');
    });

    it('builds manager user data', () => {
      expect(buildProvisioningUserData({ ...baseParams, service: 'manager' })).toBe('manager-user-data');
    });

    it('builds custom user data when template and env are provided', () => {
      const template = { id: 't1' } as CloudInitConfigEntity;

      expect(
        buildProvisioningUserData({
          ...baseParams,
          service: 'custom',
          customTemplate: template,
          resolvedCustomEnv: { FOO: 'bar' },
        }),
      ).toBe('custom-user-data');
    });

    it('throws when custom service lacks template or env', () => {
      expect(() => buildProvisioningUserData({ ...baseParams, service: 'custom' })).toThrow(
        'Custom CloudInit provisioning requires template and resolved environment variables',
      );
    });
  });
});
