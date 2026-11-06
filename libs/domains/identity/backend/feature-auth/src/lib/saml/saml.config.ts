import { ValidateInResponseTo } from '@node-saml/node-saml';

const NAMEID_FORMAT_PERSISTENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';

/** Attribute names tried (in order) for the user's email when `SAML_EMAIL_ATTRIBUTE` is unset. */
export const SAML_DEFAULT_EMAIL_ATTRIBUTES = [
  'email',
  'mail',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
] as const;

export interface SamlServiceProviderConfig {
  /** IdP single sign-on URL (HTTP-Redirect binding). */
  idpSsoUrl: string;
  /** IdP signing certificates (PEM). */
  idpCerts: string[];
  /** Expected `Issuer` of responses/assertions (IdP entity id); recommended. */
  idpIssuer?: string;
  /** SP entity id: AuthnRequest issuer and required assertion audience. */
  spEntityId: string;
  /** Assertion Consumer Service URL (public URL of `POST /api/auth/saml/acs`). */
  acsUrl: string;
  /** Console route receiving the one-time code (`/login/saml/callback`). */
  frontendCallbackUrl: string;
  nameIdFormat: string | null;
  /** Explicit email attribute; otherwise {@link SAML_DEFAULT_EMAIL_ATTRIBUTES} and email-format NameIDs are used. */
  emailAttribute?: string;
  wantAssertionsSigned: boolean;
  wantAuthnResponseSigned: boolean;
  /** Optional SP private key (PEM) to sign AuthnRequests. */
  spPrivateKey?: string;
  /** Optional SP private key (PEM) to decrypt encrypted assertions. */
  spDecryptionPrivateKey?: string;
  acceptedClockSkewMs: number;
  validateInResponseTo: ValidateInResponseTo;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return value.trim().toLowerCase() === 'true';
}

function requireUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be set when AUTHENTICATION_METHOD=saml`);
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must use http or https`);
  }

  return value;
}

/**
 * Normalizes PEM input from env vars: literal `\n` sequences, full PEM blocks (possibly several) or a bare
 * base64 body (as emitted by provisioning to keep docker-compose values single-line).
 */
export function parsePemList(raw: string, label: 'CERTIFICATE' | 'PRIVATE KEY'): string[] {
  const text = raw.replace(/\\n/g, '\n').trim();

  if (!text) {
    return [];
  }

  const blocks = text.match(/-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g);

  if (blocks && blocks.length > 0) {
    return blocks.map((block) => block.trim());
  }

  return text
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map((body) => {
      if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
        throw new Error(`Invalid ${label.toLowerCase()} value`);
      }

      const lines = body.match(/.{1,64}/g) ?? [];

      return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
    });
}

function optionalPem(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];

  if (!raw?.trim()) {
    return undefined;
  }

  const [pem] = parsePemList(raw, 'PRIVATE KEY');

  return pem;
}

/**
 * Reads SAML service provider settings (`AUTHENTICATION_METHOD=saml`). Fails fast on missing / unsafe settings:
 * signatures can be required on the assertion, the response or both, but never on neither.
 */
export function readSamlServiceProviderConfig(env: NodeJS.ProcessEnv = process.env): SamlServiceProviderConfig {
  const idpSsoUrl = requireUrl(env, 'SAML_IDP_SSO_URL');
  const acsUrl = requireUrl(env, 'SAML_SP_ACS_URL');
  const frontendCallbackUrl = requireUrl(env, 'SAML_FRONTEND_CALLBACK_URL');
  const idpCerts = parsePemList(env.SAML_IDP_CERT ?? '', 'CERTIFICATE');

  if (idpCerts.length === 0) {
    throw new Error('SAML_IDP_CERT must be set when AUTHENTICATION_METHOD=saml');
  }

  const spEntityId = env.SAML_SP_ENTITY_ID?.trim() || new URL(acsUrl).origin;
  const wantAssertionsSigned = bool(env.SAML_WANT_ASSERTIONS_SIGNED, true);
  const wantAuthnResponseSigned = bool(env.SAML_WANT_RESPONSE_SIGNED, true);

  if (!wantAssertionsSigned && !wantAuthnResponseSigned) {
    throw new Error('SAML_WANT_ASSERTIONS_SIGNED and SAML_WANT_RESPONSE_SIGNED must not both be false');
  }

  const skew = parseInt(env.SAML_CLOCK_SKEW_MS ?? '0', 10);
  const nameIdFormat = env.SAML_NAMEID_FORMAT?.trim();

  return {
    idpSsoUrl,
    idpCerts,
    idpIssuer: env.SAML_IDP_ISSUER?.trim() || undefined,
    spEntityId,
    acsUrl,
    frontendCallbackUrl,
    nameIdFormat: nameIdFormat === 'unspecified' ? null : nameIdFormat || NAMEID_FORMAT_PERSISTENT,
    emailAttribute: env.SAML_EMAIL_ATTRIBUTE?.trim() || undefined,
    wantAssertionsSigned,
    wantAuthnResponseSigned,
    spPrivateKey: optionalPem(env, 'SAML_SP_PRIVATE_KEY'),
    spDecryptionPrivateKey: optionalPem(env, 'SAML_SP_DECRYPTION_PRIVATE_KEY'),
    acceptedClockSkewMs: Number.isFinite(skew) ? Math.min(Math.max(skew, 0), 5 * 60 * 1000) : 0,
    validateInResponseTo: ValidateInResponseTo.always,
  };
}
