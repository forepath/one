/**
 * Authentication type enum for client entities.
 * Determines how the controller authenticates against a client's agent-manager.
 * - API_KEY: static API key (`STATIC_API_KEY` on the manager)
 * - OIDC: OAuth 2.0 client credentials grant against an OIDC provider (manager runs `AUTHENTICATION_METHOD=oidc`)
 */
export enum AuthenticationType {
  API_KEY = 'api_key',
  OIDC = 'oidc',
}
