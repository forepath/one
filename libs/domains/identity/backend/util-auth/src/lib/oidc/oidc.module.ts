import { Global, Module } from '@nestjs/common';

import { OidcAuthGuard } from './oidc-auth.guard';
import { OidcTokenVerifier } from './oidc-token-verifier.service';

/**
 * OIDC resource server support (`AUTHENTICATION_METHOD=oidc`): token verifier and guard.
 * Global so feature modules (socket auth, user sync) can inject {@link OidcTokenVerifier}.
 */
@Global()
@Module({
  providers: [OidcTokenVerifier, OidcAuthGuard],
  exports: [OidcTokenVerifier, OidcAuthGuard],
})
export class OidcModule {}
