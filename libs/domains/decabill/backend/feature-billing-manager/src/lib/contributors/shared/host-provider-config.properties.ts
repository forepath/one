/** Shared product config fields for Hetzner and DigitalOcean host provisioning schemas. */
export const HOST_PROVIDER_CONFIG_PROPERTIES: Record<string, Record<string, unknown>> = {
  service: {
    type: 'string',
    description:
      'Product service: agenstra-controller (full stack), agenstra-manager (agent manager only), decabill-billing (Decabill stack), or custom (admin CloudInit template)',
    enum: ['agenstra-controller', 'agenstra-manager', 'decabill-billing', 'custom'],
  },
  cloudInitConfigId: {
    type: 'string',
    description: 'CloudInit config template id (required when service is custom)',
  },
  authenticationMethod: {
    type: 'string',
    description: 'Authentication method for the agent (users, api-key, keycloak)',
  },
  staticApiKey: {
    type: 'string',
    description: 'Static API key (required when authenticationMethod is api-key)',
  },
  disableSignup: { type: 'boolean', description: 'Whether to disable user signup' },
  disableForceLogin2fa: {
    type: 'boolean',
    description: 'When true, do not force login 2FA; users may still opt in',
  },
  smtp: {
    type: 'object',
    description: 'SMTP configuration for email',
    properties: {
      host: { type: 'string' },
      port: { type: 'number' },
      user: { type: 'string' },
      password: { type: 'string' },
      from: { type: 'string' },
    },
  },
  keycloak: {
    type: 'object',
    description: 'Keycloak configuration (when authenticationMethod is keycloak)',
    properties: {
      serverUrl: { type: 'string' },
      authServerUrl: { type: 'string' },
      realm: { type: 'string' },
      clientId: { type: 'string' },
      clientSecret: { type: 'string' },
    },
  },
  hetznerApiToken: {
    type: 'string',
    description: 'Optional Hetzner API token for nested provisioning from the instance',
  },
  digitaloceanApiToken: {
    type: 'string',
    description: 'Optional DigitalOcean API token for nested provisioning from the instance',
  },
  git: {
    type: 'object',
    description: 'Optional Git configuration for manager instances (GIT_* env vars)',
    properties: {
      setupMode: {
        type: 'string',
        description: 'Repository setup mode: clone from remote or empty local repository (git init)',
        enum: ['clone', 'empty'],
      },
      repositoryUrl: { type: 'string', description: 'Git repository URL' },
      username: { type: 'string', description: 'Git username (HTTPS)' },
      token: { type: 'string', description: 'Git token (e.g. PAT)' },
      password: { type: 'string', description: 'Git password (alternative to token)' },
      privateKey: { type: 'string', description: 'SSH private key for git@ URLs' },
      commitAuthorName: { type: 'string', description: 'Default commit author name' },
      commitAuthorEmail: { type: 'string', description: 'Default commit author email' },
    },
  },
  cursorApiKey: {
    type: 'string',
    description: 'Optional Cursor API key for manager instances (CURSOR_API_KEY env var). Sensitive.',
  },
};
