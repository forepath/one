import type {
  CreateDeploymentConnectionDto,
  UpdateDeploymentConnectionDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  DEPLOYMENT_LIMITS,
  defaultDeploymentProviderAuthType,
  deploymentProviderSupportsAuthType,
  type ConnectionAuthType,
  type DeploymentConnectionSummary,
  type DeploymentConnectionWorkspaceAccess,
  type DeploymentProvider,
} from '@forepath/agenstra/shared/util-opencode-config';

/** Editable values of the connection modal (secrets are write-only: empty on edit = keep the stored ones). */
export interface DeploymentConnectionFormValue {
  label: string;
  provider: DeploymentProvider;
  baseUrl: string;
  authType: ConnectionAuthType;
  appId: string;
  installationId: string;
  privateKey: string;
  token: string;
  username: string;
  workspaceAccess: DeploymentConnectionWorkspaceAccess;
  allowedClientIds: string[];
}

export function emptyDeploymentConnectionForm(provider: DeploymentProvider = 'github'): DeploymentConnectionFormValue {
  return {
    label: '',
    provider,
    baseUrl: '',
    authType: defaultDeploymentProviderAuthType(provider),
    appId: '',
    installationId: '',
    privateKey: '',
    token: '',
    username: '',
    workspaceAccess: 'all',
    allowedClientIds: [],
  };
}

export function deploymentConnectionFormFrom(connection: DeploymentConnectionSummary): DeploymentConnectionFormValue {
  return {
    ...emptyDeploymentConnectionForm(connection.provider),
    label: connection.label,
    baseUrl: connection.baseUrl ?? '',
    authType: connection.authType,
    appId: connection.appId ?? '',
    installationId: connection.installationId ?? '',
    username: connection.username ?? '',
    workspaceAccess: connection.workspaceAccess,
    allowedClientIds: [...connection.allowedClientIds],
  };
}

/** Jenkins has no public default; GitHub (Enterprise) and GitLab (self-managed) fall back to the cloud API. */
export function deploymentConnectionBaseUrlRequired(provider: DeploymentProvider): boolean {
  return provider === 'jenkins';
}

/** Absolute `http(s)` URL without credentials, query or fragment (same rule as the controller). */
export function isValidDeploymentBaseUrl(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed || trimmed.length > DEPLOYMENT_LIMITS.baseUrlMaxLength) {
    return false;
  }

  try {
    const url = new URL(trimmed);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !trimmed.includes('?') &&
      !trimmed.includes('#')
    );
  } catch {
    return false;
  }
}

export type DeploymentConnectionFormError =
  | 'label'
  | 'baseUrl'
  | 'authType'
  | 'appId'
  | 'installationId'
  | 'privateKey'
  | 'token'
  | 'username'
  | 'workspaces';

/**
 * First problem of the form (null = valid). Secrets are required on create and when the auth type changes on edit
 * (the stored secrets belong to the previous type); otherwise empty secrets keep the stored ones.
 */
export function deploymentConnectionFormError(
  form: DeploymentConnectionFormValue,
  existing: DeploymentConnectionSummary | null,
): DeploymentConnectionFormError | null {
  const label = form.label.trim();

  if (!label || label.length > DEPLOYMENT_LIMITS.labelMaxLength) return 'label';

  const baseUrl = form.baseUrl.trim();

  if (
    deploymentConnectionBaseUrlRequired(form.provider)
      ? !isValidDeploymentBaseUrl(baseUrl)
      : baseUrl && !isValidDeploymentBaseUrl(baseUrl)
  ) {
    return 'baseUrl';
  }

  if (!deploymentProviderSupportsAuthType(form.provider, form.authType)) return 'authType';

  const secretsRequired = !existing || existing.authType !== form.authType;

  if (form.authType === 'app') {
    if (!form.appId.trim() || form.appId.trim().length > DEPLOYMENT_LIMITS.appIdMaxLength) return 'appId';
    if (!form.installationId.trim() || form.installationId.trim().length > DEPLOYMENT_LIMITS.appIdMaxLength) {
      return 'installationId';
    }
    if (
      (secretsRequired && !form.privateKey.trim()) ||
      form.privateKey.length > DEPLOYMENT_LIMITS.privateKeyMaxLength
    ) {
      return 'privateKey';
    }
  } else {
    if ((secretsRequired && !form.token.trim()) || form.token.length > DEPLOYMENT_LIMITS.tokenMaxLength) return 'token';
    if (
      (form.provider === 'jenkins' && !form.username.trim()) ||
      form.username.trim().length > DEPLOYMENT_LIMITS.usernameMaxLength
    ) {
      return 'username';
    }
  }

  if (
    form.workspaceAccess === 'selected' &&
    (form.allowedClientIds.length === 0 || form.allowedClientIds.length > DEPLOYMENT_LIMITS.allowedWorkspacesMax)
  ) {
    return 'workspaces';
  }

  return null;
}

/** Create body: only the fields of the chosen auth type; empty optional values are left out. */
export function deploymentConnectionCreateDto(form: DeploymentConnectionFormValue): CreateDeploymentConnectionDto {
  return {
    label: form.label.trim(),
    provider: form.provider,
    ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
    authType: form.authType,
    ...authFields(form),
    workspaceAccess: form.workspaceAccess,
    allowedClientIds: form.workspaceAccess === 'selected' ? [...form.allowedClientIds] : [],
  };
}

/** Update body: empty secrets are omitted (the stored ones are kept); `baseUrl: null` resets to the default. */
export function deploymentConnectionUpdateDto(form: DeploymentConnectionFormValue): UpdateDeploymentConnectionDto {
  return {
    label: form.label.trim(),
    baseUrl: form.baseUrl.trim() || null,
    authType: form.authType,
    ...authFields(form),
    workspaceAccess: form.workspaceAccess,
    allowedClientIds: form.workspaceAccess === 'selected' ? [...form.allowedClientIds] : [],
  };
}

function authFields(form: DeploymentConnectionFormValue): Partial<CreateDeploymentConnectionDto> {
  if (form.authType === 'app') {
    return {
      appId: form.appId.trim(),
      installationId: form.installationId.trim(),
      ...(form.privateKey.trim() ? { privateKey: form.privateKey.trim() } : {}),
    };
  }

  return {
    ...(form.token.trim() ? { token: form.token.trim() } : {}),
    // Jenkins authenticates with username + API token (HTTP Basic); GitHub / GitLab tokens stand alone.
    ...(form.provider === 'jenkins' ? { username: form.username.trim() } : {}),
  };
}
