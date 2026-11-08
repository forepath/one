import type { DeploymentConnectionSummary } from '@forepath/agenstra/shared/util-opencode-config';

import {
  deploymentConnectionCreateDto,
  deploymentConnectionFormError,
  deploymentConnectionFormFrom,
  deploymentConnectionUpdateDto,
  emptyDeploymentConnectionForm,
  isValidDeploymentBaseUrl,
} from './deployment-connection-form';

function summary(overrides: Partial<DeploymentConnectionSummary> = {}): DeploymentConnectionSummary {
  return {
    id: 'k1',
    label: 'GitHub',
    provider: 'github',
    baseUrl: null,
    authType: 'app',
    appId: '1',
    installationId: '2',
    username: null,
    workspaceAccess: 'all',
    allowedClientIds: [],
    lastTestStatus: 'untested',
    lastTestMessage: null,
    lastTestedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('deployment connection form', () => {
  it('defaults the auth type per provider', () => {
    expect(emptyDeploymentConnectionForm('github').authType).toBe('app');
    expect(emptyDeploymentConnectionForm('gitlab').authType).toBe('token');
    expect(emptyDeploymentConnectionForm('jenkins').authType).toBe('token');
  });

  it('validates base URLs like the controller', () => {
    expect(isValidDeploymentBaseUrl('https://ghe.example.com/api/v3')).toBe(true);
    expect(isValidDeploymentBaseUrl('ftp://example.com')).toBe(false);
    expect(isValidDeploymentBaseUrl('https://user:pw@example.com')).toBe(false);
    expect(isValidDeploymentBaseUrl('https://example.com/?a=1')).toBe(false);
    expect(isValidDeploymentBaseUrl('https://example.com/#x')).toBe(false);
    expect(isValidDeploymentBaseUrl('example.com')).toBe(false);
  });

  it('requires the credentials of the chosen auth type on create', () => {
    const github = { ...emptyDeploymentConnectionForm('github'), label: 'GitHub' };

    expect(deploymentConnectionFormError(github, null)).toBe('appId');
    expect(deploymentConnectionFormError({ ...github, appId: '1', installationId: '2' }, null)).toBe('privateKey');
    expect(
      deploymentConnectionFormError({ ...github, appId: '1', installationId: '2', privateKey: 'PEM' }, null),
    ).toBeNull();

    const jenkins = { ...emptyDeploymentConnectionForm('jenkins'), label: 'CI', token: 't' };

    expect(deploymentConnectionFormError(jenkins, null)).toBe('baseUrl');
    expect(deploymentConnectionFormError({ ...jenkins, baseUrl: 'https://ci.example.com' }, null)).toBe('username');
    expect(
      deploymentConnectionFormError({ ...jenkins, baseUrl: 'https://ci.example.com', username: 'bot' }, null),
    ).toBeNull();
    expect(
      deploymentConnectionFormError(
        { ...emptyDeploymentConnectionForm('gitlab'), label: 'GL', token: 't', workspaceAccess: 'selected' },
        null,
      ),
    ).toBe('workspaces');
  });

  it('keeps stored secrets on edit unless the auth type changes', () => {
    const existing = summary();
    const form = deploymentConnectionFormFrom(existing);

    expect(form.privateKey).toBe('');
    expect(deploymentConnectionFormError(form, existing)).toBeNull();
    expect(deploymentConnectionFormError({ ...form, authType: 'token' }, existing)).toBe('token');
    expect(deploymentConnectionUpdateDto(form)).toEqual({
      label: 'GitHub',
      baseUrl: null,
      authType: 'app',
      appId: '1',
      installationId: '2',
      workspaceAccess: 'all',
      allowedClientIds: [],
    });
  });

  it('sends only the fields of the chosen auth type', () => {
    expect(
      deploymentConnectionCreateDto({
        ...emptyDeploymentConnectionForm('jenkins'),
        label: ' CI ',
        baseUrl: 'https://ci.example.com',
        token: 'secret',
        username: 'bot',
        appId: 'ignored',
        workspaceAccess: 'selected',
        allowedClientIds: ['c1'],
      }),
    ).toEqual({
      label: 'CI',
      provider: 'jenkins',
      baseUrl: 'https://ci.example.com',
      authType: 'token',
      token: 'secret',
      username: 'bot',
      workspaceAccess: 'selected',
      allowedClientIds: ['c1'],
    });
  });
});
