/**
 * Authentication type enum for client entities.
 * Determines how the controller authenticates against a client's agent-manager.
 * - API_KEY: static API key (`STATIC_API_KEY` on the manager)
 * - OIDC: OAuth 2.0 client credentials grant against an OIDC provider (manager runs `AUTHENTICATION_METHOD=oidc`)
 * - MTLS: client certificate; every request carries a fresh certificate assertion (manager runs
 *   `AUTHENTICATION_METHOD=mtls` and trusts the certificate's CA)
 */
export enum AuthenticationType {
  API_KEY = 'api_key',
  OIDC = 'oidc',
  MTLS = 'mtls',
}
