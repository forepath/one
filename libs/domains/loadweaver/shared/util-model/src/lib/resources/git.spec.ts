import { clusterGitSchema } from './git';
import { clusterSpecSchema } from './infrastructure';
import { resourceJsonSchema } from '../resource';

describe('cluster git settings (plan bot, 3.30)', () => {
  it('defaults the public GitHub / GitLab endpoints and accepts secret references only', () => {
    expect(
      clusterGitSchema.parse({
        github: {
          appId: 12345,
          privateKey: 'secret://ops/github-app-key',
          clientId: 'Iv1.abc',
          clientSecret: 'secret://ops/github-oauth',
        },
        gitlab: { applicationId: 'app', applicationSecret: 'secret://ops/gitlab-oauth' },
      }),
    ).toEqual({
      github: {
        appId: 12345,
        privateKey: 'secret://ops/github-app-key',
        clientId: 'Iv1.abc',
        clientSecret: 'secret://ops/github-oauth',
        webUrl: 'https://github.com',
        apiUrl: 'https://api.github.com',
      },
      gitlab: {
        url: 'https://gitlab.com',
        applicationId: 'app',
        applicationSecret: 'secret://ops/gitlab-oauth',
      },
    });
    expect(
      clusterGitSchema.safeParse({ github: { appId: 1, privateKey: '-----BEGIN RSA PRIVATE KEY-----' } }).success,
    ).toBe(false);
  });

  it('requires pairs and https endpoints, and rejects private keys as CA certificates', () => {
    const ok = (git: unknown) => clusterGitSchema.safeParse(git).success;

    expect(ok({ github: { appId: 1 } })).toBe(false);
    expect(ok({ github: { clientId: 'x' } })).toBe(false);
    expect(ok({ gitlab: { applicationId: 'x' } })).toBe(false);
    expect(ok({ gitlab: { url: 'http://gitlab.example.com' } })).toBe(false);
    expect(ok({ github: { webUrl: 'https://ghe.example.com', apiUrl: 'https://ghe.example.com/api/v3' } })).toBe(true);
    expect(ok({ gitlab: { caCertificate: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n' } })).toBe(true);
    expect(ok({ gitlab: { caCertificate: '-----BEGIN PRIVATE KEY-----\nx' } })).toBe(false);
    expect(ok({ bitbucket: {} })).toBe(false);
  });

  it('is part of the cluster spec and its published JSON Schema', () => {
    const spec = clusterSpecSchema.parse({
      network: { podPoolV4: '10.0.0.0/8', servicePoolV4: '10.96.0.0/12' },
      git: { gitlab: { url: 'https://gitlab.example.com' } },
    });

    expect(spec.git?.gitlab?.url).toBe('https://gitlab.example.com');
    expect(JSON.stringify(resourceJsonSchema('Cluster'))).toContain('applicationSecret');
  });
});
