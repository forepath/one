import { BadRequestException } from '@nestjs/common';

/**
 * Provisioning helpers for the external authentication methods (`oidc`, `saml`) of provisioned products.
 * Turn requested config into typed settings, backend env lines and the console runtime auth config.
 */

/** OIDC settings of a provisioned backend (resource server) and its console (public SPA client). */
export interface ProvisionedOidcConfig {
  issuer: string;
  /** Confidential client of the API (token introspection, ONLINE validation). */
  clientId: string;
  clientSecret: string;
  /** Optional `aud` allowlist (comma-separated) for access tokens. */
  audience?: string;
  /** Public client the console signs in with; defaults to {@link clientId}. */
  frontendClientId?: string;
}

/** SAML IdP settings of a provisioned backend (the backend is the SAML SP). */
export interface ProvisionedSamlConfig {
  idpSsoUrl: string;
  /** IdP signing certificate: PEM or bare base64 body (normalized to a single base64 line). */
  idpCert: string;
  idpIssuer?: string;
  /** SP entity id; defaults to `https://<fqdn>`. */
  spEntityId?: string;
  nameIdFormat?: string;
  emailAttribute?: string;
}

/** Authentication methods of products with a console (agenstra-controller, decabill-billing). */
export type ConsoleAuthenticationMethod = 'users' | 'api-key' | 'oidc' | 'saml';

/** Authentication methods supported by the headless agent-manager. */
export type ManagerAuthenticationMethod = 'api-key' | 'oidc';

const CONSOLE_METHODS: readonly ConsoleAuthenticationMethod[] = ['users', 'api-key', 'oidc', 'saml'];

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_RUN = /[ ]*[\u0000-\u001f\u007f]+[ ]*/g;

/**
 * Removes line breaks and other control characters. Every env value ends up in a docker-compose file written
 * through a shell heredoc, so a value must never span lines (no extra YAML keys, no heredoc terminator).
 */
export function toSingleLineValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).replace(CONTROL_CHARACTER_RUN, ' ').trim();
}

/**
 * Normalizes a PEM certificate (or bare base64 body) to its base64 body on one line.
 * The backend accepts SAML_IDP_CERT as full PEM or bare base64; anything not base64 is dropped.
 */
export function normalizeCertificateBody(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const body = value.replace(/-----(BEGIN|END)[^-]*-----/g, '').replace(/\s+/g, '');

  return /^[A-Za-z0-9+/]+={0,2}$/.test(body) ? body : '';
}

function optional(value: unknown): string | undefined {
  const single = toSingleLineValue(value);

  return single.length > 0 ? single : undefined;
}

/**
 * Console products: unset → `users`; unknown values (including the removed `keycloak`) are rejected instead of
 * silently provisioning a password console with open sign-up.
 */
export function resolveConsoleAuthenticationMethod(value: unknown): ConsoleAuthenticationMethod {
  if (value === undefined || value === null || value === '') {
    return 'users';
  }

  if (CONSOLE_METHODS.includes(value as ConsoleAuthenticationMethod)) {
    return value as ConsoleAuthenticationMethod;
  }

  throw new BadRequestException(
    value === 'keycloak'
      ? 'authenticationMethod "keycloak" is no longer supported; use "oidc" (Keycloak is a standard OIDC provider) or "saml"'
      : `Unsupported authenticationMethod "${String(value)}"; expected one of: ${CONSOLE_METHODS.join(', ')}`,
  );
}

/** agent-manager: only `oidc` or `api-key` (anything else, e.g. `users` / `saml`, becomes `api-key`). */
export function resolveManagerAuthenticationMethod(value: unknown): ManagerAuthenticationMethod {
  return value === 'oidc' ? 'oidc' : 'api-key';
}

const OIDC_CLIENT_ID_PATTERN = /^[A-Za-z0-9._:@/+-]{1,255}$/;
const OIDC_AUDIENCE_PATTERN = /^[A-Za-z0-9._:@/+,=-]{1,1024}$/;

function assertProvisionedOidcValue(value: string | undefined, name: string, pattern: RegExp): void {
  if (value !== undefined && value !== '' && !pattern.test(value)) {
    throw new BadRequestException(`oidc.${name} contains unsupported characters`);
  }
}

function assertProvisionedIssuer(value: string): void {
  if (!value) {
    return;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('oidc.issuer must be an absolute http(s) URL');
  }

  // Issuer ends up in env, compose and nginx config: only plain URL characters are accepted.
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    /['"$\\\s`]/.test(value)
  ) {
    throw new BadRequestException('oidc.issuer must be an absolute http(s) URL without credentials or quotes');
  }
}

/** Reads and validates the requested OIDC settings (values reach env files, compose and nginx config). */
export function readProvisionedOidcConfig(raw: unknown): ProvisionedOidcConfig | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const oidc = raw as Record<string, unknown>;
  const config: ProvisionedOidcConfig = {
    issuer: toSingleLineValue(oidc.issuer),
    clientId: toSingleLineValue(oidc.clientId),
    clientSecret: toSingleLineValue(oidc.clientSecret),
    audience: optional(oidc.audience),
    frontendClientId: optional(oidc.frontendClientId),
  };

  assertProvisionedIssuer(config.issuer);
  assertProvisionedOidcValue(config.clientId, 'clientId', OIDC_CLIENT_ID_PATTERN);
  assertProvisionedOidcValue(config.frontendClientId, 'frontendClientId', OIDC_CLIENT_ID_PATTERN);
  assertProvisionedOidcValue(config.audience, 'audience', OIDC_AUDIENCE_PATTERN);

  return config;
}

/**
 * Console backends (controller, billing) must only accept tokens issued for their console: either a dedicated public
 * console client (`frontendClientId`, different from the API client whose service-account tokens could otherwise be
 * replayed against the console API) or an explicit `audience`.
 */
export function assertConsoleOidcConfig(method: string | undefined, oidc: ProvisionedOidcConfig | undefined): void {
  if (method !== 'oidc') {
    return;
  }

  if (!oidc?.issuer || !oidc.clientId || !oidc.clientSecret) {
    throw new BadRequestException(
      'oidc.issuer, oidc.clientId and oidc.clientSecret are required for authenticationMethod oidc',
    );
  }

  const hasDistinctConsoleClient = !!oidc.frontendClientId && oidc.frontendClientId !== oidc.clientId;

  if (!hasDistinctConsoleClient && !oidc.audience) {
    throw new BadRequestException(
      'oidc.frontendClientId (a public client different from oidc.clientId) or oidc.audience is required so the console API only accepts console tokens',
    );
  }
}

/**
 * Body for nginx `return 200 '<body>';`: JSON whose `$` and `'` are written as JSON unicode escapes (nginx would
 * interpolate `$name` and `'` ends the string) and whose backslashes are doubled for nginx's quoted-string parser.
 * The client receives byte-identical JSON semantics.
 */
export function toNginxJsonReturnBody(value: unknown): string {
  const json = JSON.stringify(value ?? {})
    .replace(/\$/g, '\\u0024')
    .replace(/'/g, '\\u0027');

  return json.replace(/\\/g, '\\\\');
}

export function readProvisionedSamlConfig(raw: unknown): ProvisionedSamlConfig | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const saml = raw as Record<string, unknown>;

  return {
    idpSsoUrl: toSingleLineValue(saml.idpSsoUrl),
    idpCert: normalizeCertificateBody(saml.idpCert),
    idpIssuer: optional(saml.idpIssuer),
    spEntityId: optional(saml.spEntityId),
    nameIdFormat: optional(saml.nameIdFormat),
    emailAttribute: optional(saml.emailAttribute),
  };
}

/**
 * Backend env lines for `AUTHENTICATION_METHOD=oidc` (empty for other methods).
 *
 * - `console` (controller, billing): the API's confidential client (introspection) and an `azp` restriction to the
 *   console's public client, so tokens of other clients / service accounts of the issuer are rejected.
 * - `manager`: OFFLINE validation pinned to the controller's client (`azp`). The manager never receives the client
 *   secret, so a compromised manager host cannot mint tokens accepted elsewhere.
 */
export function buildOidcEnvLines(
  method: string | undefined,
  oidc: ProvisionedOidcConfig | undefined,
  options: { role?: 'console' | 'manager' } = {},
): string[] {
  if (method !== 'oidc') {
    return [];
  }

  const clientId = toSingleLineValue(oidc?.clientId);
  const issuer = `OIDC_ISSUER: ${toSingleLineValue(oidc?.issuer)}`;
  const audience = oidc?.audience ? [`OIDC_AUDIENCE: ${toSingleLineValue(oidc.audience)}`] : [];

  if (options.role === 'manager') {
    return [
      issuer,
      'OIDC_TOKEN_VALIDATION: OFFLINE',
      ...audience,
      ...(clientId ? [`OIDC_AUTHORIZED_PARTIES: ${clientId}`] : []),
    ];
  }

  const frontendClientId = toSingleLineValue(oidc?.frontendClientId);
  // Only a dedicated console client may be the authorized party (never the API's own service-account client).
  const consoleClientId = frontendClientId && frontendClientId !== clientId ? frontendClientId : '';

  return [
    issuer,
    `OIDC_CLIENT_ID: ${clientId}`,
    `OIDC_CLIENT_SECRET: ${toSingleLineValue(oidc?.clientSecret)}`,
    ...audience,
    ...(consoleClientId ? [`OIDC_AUTHORIZED_PARTIES: ${consoleClientId}`] : []),
  ];
}

/** Backend env lines for `AUTHENTICATION_METHOD=saml` (empty for other methods). */
export function buildSamlEnvLines(
  method: string | undefined,
  saml: ProvisionedSamlConfig | undefined,
  fqdn: string,
): string[] {
  if (method !== 'saml') {
    return [];
  }

  const host = toSingleLineValue(fqdn);

  return [
    `SAML_IDP_SSO_URL: ${toSingleLineValue(saml?.idpSsoUrl)}`,
    `SAML_IDP_CERT: ${normalizeCertificateBody(saml?.idpCert)}`,
    ...(saml?.idpIssuer ? [`SAML_IDP_ISSUER: ${toSingleLineValue(saml.idpIssuer)}`] : []),
    `SAML_SP_ENTITY_ID: ${toSingleLineValue(saml?.spEntityId) || `https://${host}`}`,
    `SAML_SP_ACS_URL: https://${host}/api/auth/saml/acs`,
    `SAML_FRONTEND_CALLBACK_URL: https://${host}/login/saml/callback`,
    ...(saml?.nameIdFormat ? [`SAML_NAMEID_FORMAT: ${toSingleLineValue(saml.nameIdFormat)}`] : []),
    ...(saml?.emailAttribute ? [`SAML_EMAIL_ATTRIBUTE: ${toSingleLineValue(saml.emailAttribute)}`] : []),
  ];
}

/** Console runtime `authentication.config` for the selected method. */
export function buildConsoleAuthenticationConfig(
  method: ConsoleAuthenticationMethod,
  options: { oidc?: ProvisionedOidcConfig; disableSignup?: boolean },
): Record<string, unknown> {
  switch (method) {
    case 'api-key':
      return { type: 'api-key' };
    case 'oidc':
      return {
        type: 'oidc',
        issuer: options.oidc?.issuer ?? '',
        clientId: options.oidc?.frontendClientId ?? options.oidc?.clientId ?? '',
      };
    case 'saml':
      return { type: 'saml' };
    default:
      return { type: 'users', disableSignup: options.disableSignup ?? false };
  }
}
