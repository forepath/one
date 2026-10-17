import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

/** HTTP transport (fetch by default; tests inject one that trusts a test CA). */
export type AcmeTransport = (
  url: string,
  init: { method: 'GET' | 'HEAD' | 'POST'; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

interface Directory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
}

export interface AcmeOrder {
  url: string;
  status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid';
  authorizations: string[];
  finalize: string;
  certificate?: string;
}

export interface AcmeChallenge {
  type: string;
  url: string;
  token: string;
  status: string;
}

export interface AcmeAuthorization {
  status: 'pending' | 'valid' | 'invalid' | 'deactivated' | 'expired' | 'revoked';
  identifier: { type: 'dns'; value: string };
  challenges: AcmeChallenge[];
  wildcard?: boolean;
}

export class AcmeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
  }
}

/** RFC 8555 §6.1: every request carries a User-Agent. */
const USER_AGENT = 'loadweaver-acme/1';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Minimal ACME (RFC 8555) client for the built-in certificates (3.6): ES256 account key, HTTP-01 and DNS-01.
 * Flattened JWS, nonces from the server, one retry on `badNonce`.
 */
export class AcmeClient {
  private directory: Directory | null = null;
  private nonce: string | null = null;

  constructor(
    private readonly directoryUrl: string,
    private readonly accountKeyPem: string,
    private readonly transport: AcmeTransport = (url, init) =>
      fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) }),
    private kid: string | null = null,
  ) {}

  get accountUrl(): string | null {
    return this.kid;
  }

  /** Public account key as JWK (RFC 7517), members in thumbprint order. */
  jwk(): { crv: string; kty: string; x: string; y: string } {
    const jwk = createPublicKey(createPrivateKey(this.accountKeyPem)).export({ format: 'jwk' }) as {
      crv: string;
      kty: string;
      x: string;
      y: string;
    };

    return { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  }

  /** RFC 7638 thumbprint, part of every key authorization. */
  thumbprint(): string {
    return b64url(createHash('sha256').update(JSON.stringify(this.jwk())).digest());
  }

  keyAuthorization(token: string): string {
    return `${token}.${this.thumbprint()}`;
  }

  /** TXT value of `_acme-challenge.<name>` for DNS-01. */
  dnsTxtValue(token: string): string {
    return b64url(createHash('sha256').update(this.keyAuthorization(token)).digest());
  }

  private async dir(): Promise<Directory> {
    if (!this.directory) {
      const res = await this.transport(this.directoryUrl, { method: 'GET', headers: { 'User-Agent': USER_AGENT } });

      if (!res.ok) throw new AcmeError(`ACME directory unavailable: HTTP ${res.status}`, res.status);

      this.directory = (await res.json()) as Directory;
    }

    return this.directory;
  }

  private async freshNonce(): Promise<string> {
    if (this.nonce) {
      const nonce = this.nonce;

      this.nonce = null;

      return nonce;
    }

    const res = await this.transport((await this.dir()).newNonce, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
    });
    const nonce = res.headers.get('replay-nonce');

    if (!nonce) throw new AcmeError('ACME server sent no nonce', res.status);

    return nonce;
  }

  /** Signed POST; `payload === undefined` is POST-as-GET. */
  private async post(url: string, payload: unknown, useJwk = false, retried = false): Promise<Response> {
    const header = {
      alg: 'ES256',
      nonce: await this.freshNonce(),
      url,
      ...(useJwk || !this.kid ? { jwk: this.jwk() } : { kid: this.kid }),
    };
    const protectedHeader = b64url(JSON.stringify(header));
    const body = payload === undefined ? '' : b64url(JSON.stringify(payload));
    const signature = sign('sha256', Buffer.from(`${protectedHeader}.${body}`), {
      key: createPrivateKey(this.accountKeyPem),
      dsaEncoding: 'ieee-p1363',
    });
    const res = await this.transport(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/jose+json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ protected: protectedHeader, payload: body, signature: b64url(signature) }),
    });

    this.nonce = res.headers.get('replay-nonce');

    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { type?: string; detail?: string };

      if (problem.type === 'urn:ietf:params:acme:error:badNonce' && !retried)
        return await this.post(url, payload, useJwk, true);

      throw new AcmeError(`ACME ${problem.type ?? 'error'}: ${problem.detail ?? res.status}`, res.status, problem.type);
    }

    return res;
  }

  /** Creates (or finds) the account for this key; returns its URL. */
  async register(contactEmail?: string): Promise<string> {
    const res = await this.post(
      (await this.dir()).newAccount,
      { termsOfServiceAgreed: true, ...(contactEmail ? { contact: [`mailto:${contactEmail}`] } : {}) },
      true,
    );
    const kid = res.headers.get('location');

    if (!kid) throw new AcmeError('ACME server returned no account URL', res.status);

    this.kid = kid;

    return kid;
  }

  async newOrder(names: string[]): Promise<AcmeOrder> {
    const res = await this.post((await this.dir()).newOrder, {
      identifiers: names.map((value) => ({ type: 'dns', value })),
    });
    const url = res.headers.get('location');

    if (!url) throw new AcmeError('ACME server returned no order URL', res.status);

    return { ...((await res.json()) as Omit<AcmeOrder, 'url'>), url };
  }

  async order(url: string): Promise<AcmeOrder> {
    return { ...((await (await this.post(url, undefined)).json()) as Omit<AcmeOrder, 'url'>), url };
  }

  async authorization(url: string): Promise<AcmeAuthorization> {
    return (await (await this.post(url, undefined)).json()) as AcmeAuthorization;
  }

  /** Tells the server the challenge is ready to be validated. */
  async respond(challengeUrl: string): Promise<void> {
    await this.post(challengeUrl, {});
  }

  async finalize(order: AcmeOrder, csrDer: Buffer): Promise<AcmeOrder> {
    return {
      ...((await (await this.post(order.finalize, { csr: b64url(csrDer) })).json()) as Omit<AcmeOrder, 'url'>),
      url: order.url,
    };
  }

  /** The issued certificate chain (PEM). */
  async certificate(url: string): Promise<string> {
    return await (await this.post(url, undefined)).text();
  }
}
