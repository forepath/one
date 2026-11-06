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
    description:
      'Authentication method: users, api-key, oidc or saml (agenstra-manager supports api-key and oidc only; anything else falls back to api-key)',
    enum: ['users', 'api-key', 'oidc', 'saml'],
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
  oidc: {
    type: 'object',
    description: 'OpenID Connect provider (when authenticationMethod is oidc)',
    properties: {
      issuer: { type: 'string', description: 'Issuer URL (exact `iss` of access tokens; discovery base)' },
      clientId: { type: 'string', description: 'Confidential client of the API (token introspection)' },
      clientSecret: { type: 'string', description: 'Secret of the confidential API client' },
      audience: { type: 'string', description: 'Optional comma-separated `aud` allowlist for access tokens' },
      frontendClientId: {
        type: 'string',
        description: 'Public client the console signs in with (Authorization Code + PKCE); defaults to clientId',
      },
    },
  },
  saml: {
    type: 'object',
    description:
      'SAML 2.0 identity provider (when authenticationMethod is saml). The instance is the service provider: ACS https://<fqdn>/api/auth/saml/acs, metadata https://<fqdn>/api/auth/saml/metadata',
    properties: {
      idpSsoUrl: { type: 'string', description: 'IdP single sign-on URL (HTTP-Redirect binding)' },
      idpCert: { type: 'string', description: 'IdP signing certificate (PEM or base64 body)' },
      idpIssuer: { type: 'string', description: 'Optional expected IdP entity id (Issuer)' },
      spEntityId: { type: 'string', description: 'Optional SP entity id; defaults to https://<fqdn>' },
      nameIdFormat: { type: 'string', description: 'Optional NameID format; defaults to persistent' },
      emailAttribute: { type: 'string', description: 'Optional assertion attribute holding the email address' },
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
};
