import type { CloudInitConfigOrderField } from '@forepath/decabill/frontend/data-access-billing-console';
import type { PlanAddonOptionDto } from '@forepath/decabill/frontend/data-access-billing-console';

export type IntegratedOrderService = 'agenstra-controller' | 'agenstra-manager' | 'decabill-billing' | 'custom';

export type IntegratedOrderAuthMethod = 'users' | 'api-key' | 'keycloak';

export interface IntegratedOrderFormConfig {
  service: IntegratedOrderService;
  authenticationMethod: IntegratedOrderAuthMethod;
  staticApiKey: string;
  disableSignup: boolean;
  smtp: { host: string; port: number; user: string; password: string; from: string };
  keycloak: { serverUrl: string; authServerUrl: string; realm: string; clientId: string; clientSecret: string };
  hetznerApiToken: string;
  digitaloceanApiToken: string;
  git: {
    setupMode: 'clone' | 'empty';
    repositoryUrl: string;
    username: string;
    token: string;
    password: string;
    privateKey: string;
    commitAuthorName: string;
    commitAuthorEmail: string;
  };
  cursorApiKey: string;
}

export function createDefaultIntegratedOrderConfig(): IntegratedOrderFormConfig {
  return {
    service: 'agenstra-controller',
    authenticationMethod: 'users',
    staticApiKey: '',
    disableSignup: false,
    smtp: {
      host: 'mailhog',
      port: 1025,
      user: '',
      password: '',
      from: 'noreply@localhost',
    },
    keycloak: {
      serverUrl: '',
      authServerUrl: '',
      realm: '',
      clientId: '',
      clientSecret: '',
    },
    hetznerApiToken: '',
    digitaloceanApiToken: '',
    git: {
      setupMode: 'clone',
      repositoryUrl: '',
      username: '',
      token: '',
      password: '',
      privateKey: '',
      commitAuthorName: '',
      commitAuthorEmail: '',
    },
    cursorApiKey: '',
  };
}

export interface BuildPlanOrderRequestedConfigParams {
  integrated: IntegratedOrderFormConfig;
  customOrderFields: CloudInitConfigOrderField[];
  customEnv: Record<string, string>;
  provisioningOptionKey: string;
  showProvisioningPicker: boolean;
  provisioningProvider: string;
  hasProviderSelection: boolean;
  geographyFieldKey: 'region' | 'location' | null;
  provisioningLocation: string;
  provisioningServerType: string;
}

export function buildPlanOrderRequestedConfig(params: BuildPlanOrderRequestedConfigParams): Record<string, unknown> {
  const cfg = params.integrated;

  if (cfg.service === 'custom') {
    const env: Record<string, string> = {};

    for (const field of params.customOrderFields) {
      const value = (params.customEnv[field.key] ?? '').trim();

      if (value || field.required) {
        env[field.key] = value;
      }
    }

    const requestedConfig: Record<string, unknown> = {
      service: 'custom',
      env,
    };

    attachOrderProvider(requestedConfig, params);
    attachGeography(requestedConfig, params);
    attachServerType(requestedConfig, params.provisioningServerType);
    attachProvisioningOptionKey(requestedConfig, params);

    return requestedConfig;
  }

  const requestedConfig: Record<string, unknown> = {
    service: cfg.service,
    authenticationMethod: cfg.authenticationMethod,
    smtp: { ...cfg.smtp },
  };

  attachOrderProvider(requestedConfig, params);

  if (cfg.service === 'agenstra-controller' || cfg.service === 'decabill-billing') {
    requestedConfig['disableSignup'] = cfg.disableSignup;
  }

  if (cfg.authenticationMethod === 'api-key' && cfg.staticApiKey.trim()) {
    requestedConfig['staticApiKey'] = cfg.staticApiKey.trim();
  }

  if (cfg.authenticationMethod === 'keycloak') {
    requestedConfig['keycloak'] = { ...cfg.keycloak };
  }

  if (cfg.service === 'agenstra-controller' || cfg.service === 'decabill-billing') {
    if (cfg.hetznerApiToken.trim()) {
      requestedConfig['hetznerApiToken'] = cfg.hetznerApiToken.trim();
    }

    if (cfg.digitaloceanApiToken.trim()) {
      requestedConfig['digitaloceanApiToken'] = cfg.digitaloceanApiToken.trim();
    }
  }

  attachGeography(requestedConfig, params);
  attachServerType(requestedConfig, params.provisioningServerType);

  if (cfg.service === 'agenstra-manager') {
    const gitSetupMode = cfg.git.setupMode ?? 'clone';
    const hasGitCloneFields =
      cfg.git.repositoryUrl.trim() !== '' ||
      cfg.git.username.trim() !== '' ||
      cfg.git.token.trim() !== '' ||
      cfg.git.password.trim() !== '' ||
      cfg.git.privateKey.trim() !== '' ||
      cfg.git.commitAuthorName.trim() !== '' ||
      cfg.git.commitAuthorEmail.trim() !== '';

    if (gitSetupMode === 'empty' || hasGitCloneFields) {
      requestedConfig['git'] = {
        setupMode: gitSetupMode,
        ...(gitSetupMode === 'clone'
          ? {
              repositoryUrl: cfg.git.repositoryUrl.trim() || undefined,
              username: cfg.git.username.trim() || undefined,
              token: cfg.git.token.trim() || undefined,
              password: cfg.git.password.trim() || undefined,
              privateKey: cfg.git.privateKey.trim() || undefined,
              commitAuthorName: cfg.git.commitAuthorName.trim() || undefined,
              commitAuthorEmail: cfg.git.commitAuthorEmail.trim() || undefined,
            }
          : {}),
      };
    }

    if (cfg.cursorApiKey.trim()) {
      requestedConfig['cursorApiKey'] = cfg.cursorApiKey.trim();
    }
  }

  attachProvisioningOptionKey(requestedConfig, params);

  return requestedConfig;
}

export function buildPlanOrderAddonConfigs(
  addonIds: Set<string>,
  addons: PlanAddonOptionDto[],
  addonConfigs: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> | undefined {
  const result: Record<string, Record<string, string>> = {};

  for (const addonId of addonIds) {
    const addon = addons.find((entry) => entry.id === addonId);

    if (!addon?.orderFields?.length) {
      continue;
    }

    const env: Record<string, string> = {};

    for (const field of addon.orderFields) {
      const value = (addonConfigs[addonId]?.[field.key] ?? '').trim();

      if (value || field.required) {
        env[field.key] = value;
      }
    }

    if (Object.keys(env).length > 0) {
      result[addonId] = env;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function attachProvisioningOptionKey(
  requestedConfig: Record<string, unknown>,
  params: BuildPlanOrderRequestedConfigParams,
): void {
  if (params.showProvisioningPicker && params.provisioningOptionKey.trim()) {
    requestedConfig['provisioningOptionKey'] = params.provisioningOptionKey.trim();
  }
}

function attachOrderProvider(
  requestedConfig: Record<string, unknown>,
  params: BuildPlanOrderRequestedConfigParams,
): void {
  if (params.hasProviderSelection && params.provisioningProvider.trim()) {
    requestedConfig['provider'] = params.provisioningProvider.trim();
  }
}

function attachGeography(requestedConfig: Record<string, unknown>, params: BuildPlanOrderRequestedConfigParams): void {
  if (params.geographyFieldKey && params.provisioningLocation.trim()) {
    requestedConfig[params.geographyFieldKey] = params.provisioningLocation.trim();
  }
}

function attachServerType(requestedConfig: Record<string, unknown>, serverType: string): void {
  if (serverType.trim()) {
    requestedConfig['serverType'] = serverType.trim();
  }
}
