import { CloudInitConfigEntity } from '../../entities/cloud-init-config.entity';
import {
  buildCustomConfigurationCloudInitConfigFromRequest,
  buildCustomConfigurationCloudInitUserData,
} from './custom-configuration.utils';

describe('custom-configuration.utils', () => {
  const baseTemplate: CloudInitConfigEntity = {
    id: 'cfg-1',
    tenantId: 'default',
    key: 'my-app',
    name: 'My App',
    provisioningMode: 'simple',
    dockerImage: 'nginx:alpine',
    containerPort: 8080,
    hostPort: 80,
    workDir: '/opt/custom-app',
    environmentVariables: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('buildCustomConfigurationCloudInitConfigFromRequest', () => {
    it('sets host fqdn and app settings from template and resolved env', () => {
      const config = buildCustomConfigurationCloudInitConfigFromRequest(
        baseTemplate,
        { API_KEY: 'secret' },
        { sshPublicKey: 'ssh-rsa AAA' },
        'host1',
        'example.com',
      );

      expect(config.host.fqdn).toBe('host1.example.com');
      expect(config.ssh.publicKey).toBe('ssh-rsa AAA');
      expect(config.app.dockerImage).toBe('nginx:alpine');
      expect(config.app.environment).toEqual({ API_KEY: 'secret' });
    });
  });

  describe('buildCustomConfigurationCloudInitUserData', () => {
    it('returns base64-encoded script with docker compose and env vars for simple mode', () => {
      const config = buildCustomConfigurationCloudInitConfigFromRequest(
        baseTemplate,
        { API_KEY: 'secret' },
        { sshPublicKey: 'key' },
        'host1',
      );
      const userData = buildCustomConfigurationCloudInitUserData(baseTemplate, config);
      const decoded = Buffer.from(userData, 'base64').toString('utf8');

      expect(decoded).toContain('nginx:alpine');
      expect(decoded).toContain('API_KEY');
      expect(decoded).toContain('secret');
      expect(decoded).toContain('docker compose up -d');
      expect(decoded).toContain('/opt/custom-app');
    });

    it('quotes workDir in bootstrap shell commands', () => {
      const template: CloudInitConfigEntity = {
        ...baseTemplate,
        workDir: '/opt/my_app',
      };
      const config = buildCustomConfigurationCloudInitConfigFromRequest(template, {}, { sshPublicKey: 'key' }, 'host1');
      const decoded = Buffer.from(buildCustomConfigurationCloudInitUserData(template, config), 'base64').toString(
        'utf8',
      );

      expect(decoded).toContain("mkdir -p '/opt/my_app'");
      expect(decoded).toContain("cd '/opt/my_app'");
    });

    it('rejects invalid workDir at provisioning time', () => {
      const template: CloudInitConfigEntity = {
        ...baseTemplate,
        workDir: '/tmp/evil',
      };

      expect(() =>
        buildCustomConfigurationCloudInitConfigFromRequest(template, {}, { sshPublicKey: 'key' }, 'host1'),
      ).toThrow('workDir must be an absolute path under /opt');
    });

    it('uses interpolated compose template in compose-template mode', () => {
      const template: CloudInitConfigEntity = {
        ...baseTemplate,
        provisioningMode: 'compose-template',
        dockerComposeTemplate: `services:
  web:
    image: {{DOCKER_IMAGE}}
    environment:
      API_KEY: {{env.API_KEY}}`,
        environmentVariables: [{ key: 'API_KEY', label: 'API Key', showInOrderForm: true, hasDefault: true }],
      };
      const config = buildCustomConfigurationCloudInitConfigFromRequest(
        template,
        { API_KEY: 'from-order' },
        { sshPublicKey: 'key' },
        'host1',
      );
      const decoded = Buffer.from(buildCustomConfigurationCloudInitUserData(template, config), 'base64').toString(
        'utf8',
      );

      expect(decoded).toContain('image: nginx:alpine');
      expect(decoded).toContain('API_KEY: from-order');
      expect(decoded).not.toContain('{{DOCKER_IMAGE}}');
    });

    it('uses full user-data template in user-data-template mode', () => {
      const template: CloudInitConfigEntity = {
        ...baseTemplate,
        provisioningMode: 'user-data-template',
        userDataTemplate: '#!/bin/bash\necho host={{HOSTNAME}} key={{env.API_KEY}}',
        environmentVariables: [{ key: 'API_KEY', label: 'API Key', showInOrderForm: true, hasDefault: true }],
      };
      const config = buildCustomConfigurationCloudInitConfigFromRequest(
        template,
        { API_KEY: 'custom' },
        { sshPublicKey: 'key' },
        'host1',
      );
      const decoded = Buffer.from(buildCustomConfigurationCloudInitUserData(template, config), 'base64').toString(
        'utf8',
      );

      expect(decoded).toBe("#!/bin/bash\necho host=host1 key='custom'");
      expect(decoded).not.toContain('docker compose');
    });

    it('falls back to default compose template when compose-template mode has no stored template', () => {
      const template: CloudInitConfigEntity = {
        ...baseTemplate,
        provisioningMode: 'compose-template',
        dockerComposeTemplate: null,
      };
      const config = buildCustomConfigurationCloudInitConfigFromRequest(template, {}, { sshPublicKey: 'key' }, 'host1');
      const decoded = Buffer.from(buildCustomConfigurationCloudInitUserData(template, config), 'base64').toString(
        'utf8',
      );

      expect(decoded).toContain('image: nginx:alpine');
    });
  });
});
