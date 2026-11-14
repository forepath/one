import { CloudInitConfigEntity } from '../entities/cloud-init-config.entity';
import { CloudInitServiceType } from '../utils/cloud-init/integrated-provisioning-service';

import { CloudInitDispatchService } from './cloud-init-dispatch.service';
import { IntegratedStackRegistryService } from './integrated-stack-registry.service';

jest.mock('../utils/cloud-init/custom-configuration.utils', () => ({
  buildCustomConfigurationCloudInitConfigFromRequest: jest.fn().mockReturnValue({ app: {} }),
  buildCustomConfigurationCloudInitUserData: jest.fn().mockReturnValue('custom-user-data'),
}));

describe('CloudInitDispatchService', () => {
  const baseParams = {
    effectiveConfig: { service: CloudInitServiceType.AgenstraController },
    hostname: 'host1',
    baseDomain: 'spirde.com',
  };

  function createService(registry: IntegratedStackRegistryService): CloudInitDispatchService {
    return new CloudInitDispatchService(registry);
  }

  it('builds custom user data when template and env are provided', () => {
    const dispatch = createService(new IntegratedStackRegistryService());
    const template = { id: 't1' } as CloudInitConfigEntity;

    expect(
      dispatch.buildUserData({
        ...baseParams,
        service: CloudInitServiceType.Custom,
        customTemplate: template,
        resolvedCustomEnv: { FOO: 'bar' },
      }),
    ).toBe('custom-user-data');
  });

  it('throws when custom service lacks template or env', () => {
    const dispatch = createService(new IntegratedStackRegistryService());

    expect(() => dispatch.buildUserData({ ...baseParams, service: CloudInitServiceType.Custom })).toThrow(
      'Custom CloudInit provisioning requires template and resolved environment variables',
    );
  });

  it('uses the registered stack buildUserData for each first-party key', () => {
    const registry = new IntegratedStackRegistryService();

    registry.register({
      key: 'agenstra-controller',
      displayName: 'Agenstra Controller',
      buildUserData: () => 'controller-user-data',
    });
    registry.register({
      key: 'agenstra-manager',
      displayName: 'Agenstra Manager',
      buildUserData: () => 'manager-user-data',
    });
    registry.register({
      key: 'decabill-billing',
      displayName: 'Decabill Billing',
      buildUserData: () => 'decabill-user-data',
    });
    const dispatch = createService(registry);

    expect(dispatch.buildUserData({ ...baseParams, service: CloudInitServiceType.AgenstraController })).toBe(
      'controller-user-data',
    );
    expect(dispatch.buildUserData({ ...baseParams, service: CloudInitServiceType.AgenstraManager })).toBe(
      'manager-user-data',
    );
    expect(dispatch.buildUserData({ ...baseParams, service: CloudInitServiceType.DecabillBilling })).toBe(
      'decabill-user-data',
    );
  });

  it('maps legacy controller and manager aliases to registered stacks', () => {
    const registry = new IntegratedStackRegistryService();

    registry.register({
      key: 'agenstra-controller',
      displayName: 'Agenstra Controller',
      buildUserData: () => 'controller-user-data',
    });
    registry.register({
      key: 'agenstra-manager',
      displayName: 'Agenstra Manager',
      buildUserData: () => 'manager-user-data',
    });
    const dispatch = createService(registry);

    expect(dispatch.buildUserData({ ...baseParams, service: 'controller' })).toBe('controller-user-data');
    expect(dispatch.buildUserData({ ...baseParams, service: 'manager' })).toBe('manager-user-data');
  });

  it('throws for unknown integrated keys instead of falling back to controller', () => {
    const registry = new IntegratedStackRegistryService();

    registry.register({
      key: 'agenstra-controller',
      displayName: 'Agenstra Controller',
      buildUserData: () => 'controller-user-data',
    });
    const dispatch = createService(registry);

    expect(() => dispatch.buildUserData({ ...baseParams, service: 'other' })).toThrow(
      'Unknown integrated CloudInit stack',
    );
    expect(() => dispatch.buildUserData({ ...baseParams, service: undefined })).toThrow(
      'Unknown integrated CloudInit stack',
    );
  });

  it('throws when the stack is registered without buildUserData', () => {
    const registry = new IntegratedStackRegistryService();

    registry.register({
      key: 'agenstra-manager',
      displayName: 'Agenstra Manager',
    });
    const dispatch = createService(registry);

    expect(() => dispatch.buildUserData({ ...baseParams, service: CloudInitServiceType.AgenstraManager })).toThrow(
      'Integrated CloudInit stack is not provisionable: agenstra-manager',
    );
  });

  it('builds bare server user data with only the SSH access baseline for service none', () => {
    const dispatch = createService(new IntegratedStackRegistryService());
    const userData = dispatch.buildUserData({
      ...baseParams,
      service: CloudInitServiceType.None,
      effectiveConfig: { service: 'none', sshPublicKey: 'ssh-ed25519 AAAATEST decabill' },
    });
    const script = Buffer.from(userData, 'base64').toString('utf8');

    expect(script.startsWith('#!/bin/bash')).toBe(true);
    expect(script).toContain(`printf '%s\\n' 'ssh-ed25519 AAAATEST decabill' > /root/.ssh/authorized_keys`);
    expect(script).toContain('PasswordAuthentication no');
    expect(script).not.toContain('docker');
  });

  it('fails closed for service none without an SSH public key', () => {
    const dispatch = createService(new IntegratedStackRegistryService());

    expect(() =>
      dispatch.buildUserData({
        ...baseParams,
        service: CloudInitServiceType.None,
        effectiveConfig: { service: 'none' },
      }),
    ).toThrow('Bare server provisioning requires an SSH public key');
  });
});
