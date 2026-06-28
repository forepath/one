import {
  DEFAULT_COMPOSE_TEMPLATE,
  DEFAULT_USER_DATA_TEMPLATE,
  interpolateCloudInitTemplate,
  type CloudInitTemplateContext,
} from './template-interpolation.utils';

describe('template-interpolation.utils', () => {
  const baseContext: CloudInitTemplateContext = {
    hostname: 'app1',
    fqdn: 'app1.example.com',
    workDir: '/opt/custom-app',
    sshPublicKey: 'ssh-rsa AAA',
    dockerImage: 'nginx:alpine',
    containerPort: 8080,
    hostPort: 80,
    environment: {
      API_KEY: 'secret',
    },
  };

  describe('interpolateCloudInitTemplate', () => {
    it('replaces built-in placeholders', () => {
      const rendered = interpolateCloudInitTemplate(
        'host={{HOSTNAME}} image={{DOCKER_IMAGE}} port={{HOST_PORT}}',
        baseContext,
        ['API_KEY'],
      );

      expect(rendered).toBe('host=app1 image=nginx:alpine port=80');
    });

    it('replaces environment placeholders for yaml output', () => {
      const rendered = interpolateCloudInitTemplate('API_KEY: {{env.API_KEY}}', baseContext, ['API_KEY'], 'yaml');

      expect(rendered).toBe('API_KEY: secret');
    });

    it('shell-escapes environment placeholders for user-data templates', () => {
      const rendered = interpolateCloudInitTemplate(
        'export API_KEY={{env.API_KEY}}',
        { ...baseContext, environment: { API_KEY: "o'hara" } },
        ['API_KEY'],
        'shell',
      );

      expect(rendered).toBe("export API_KEY='o'\"'\"'hara'");
    });

    it('shell-escapes built-in placeholders for user-data templates', () => {
      const rendered = interpolateCloudInitTemplate('mkdir -p {{WORK_DIR}}', baseContext, [], 'shell');

      expect(rendered).toBe("mkdir -p '/opt/custom-app'");
    });

    it('rejects unknown built-in placeholders', () => {
      expect(() => interpolateCloudInitTemplate('{{UNKNOWN}}', baseContext, [])).toThrow(
        'Unknown template placeholder',
      );
    });

    it('rejects unknown environment placeholders', () => {
      expect(() => interpolateCloudInitTemplate('{{env.MISSING}}', baseContext, ['API_KEY'])).toThrow(
        'Unknown environment placeholder',
      );
    });

    it('rejects unresolved placeholders after interpolation', () => {
      expect(() => interpolateCloudInitTemplate('value={{ ENV }}', baseContext, [])).toThrow('unresolved placeholders');
    });
  });

  it('exports a default compose template with docker placeholders', () => {
    expect(DEFAULT_COMPOSE_TEMPLATE).toContain('{{DOCKER_IMAGE}}');
    expect(DEFAULT_COMPOSE_TEMPLATE).toContain('environment: {}');
  });

  it('exports a default user-data template that interpolates without env keys', () => {
    const context: CloudInitTemplateContext = {
      hostname: 'app1',
      fqdn: 'app1.example.com',
      workDir: '/opt/custom-app',
      sshPublicKey: 'ssh-rsa AAA',
      dockerImage: 'nginx:alpine',
      containerPort: 8080,
      hostPort: 80,
      environment: {},
    };

    const rendered = interpolateCloudInitTemplate(DEFAULT_USER_DATA_TEMPLATE, context, [], 'shell');

    expect(rendered).toContain('#!/bin/bash');
    expect(rendered).toContain('Provisioning app1 (app1.example.com)');
    expect(rendered).toContain("mkdir -p '/opt/custom-app'");
    expect(rendered).toContain('image: nginx:alpine');
    expect(rendered).not.toContain('{{HOSTNAME}}');
  });
});
