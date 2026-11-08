import type { ConnectionAuthType, ConnectionTestStatus } from '@forepath/agenstra/shared/util-opencode-config';

/** Never contains `apiToken` or `oauthClientSecret`. */
export class AtlassianSiteConnectionResponseDto {
  id!: string;
  label?: string | null;
  baseUrl!: string;
  authType!: ConnectionAuthType;
  /** `token` connections only. */
  accountEmail!: string | null;
  /** OAuth client id of the service account credential (`app` connections only; not a secret). */
  oauthClientId!: string | null;
  /** Atlassian Cloud id resolved for `app` connections. */
  cloudId!: string | null;
  lastTestStatus!: ConnectionTestStatus;
  lastTestMessage!: string | null;
  lastTestedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AtlassianConnectionTestResultDto {
  ok!: boolean;
  message?: string;
  testedAt!: string;
}
