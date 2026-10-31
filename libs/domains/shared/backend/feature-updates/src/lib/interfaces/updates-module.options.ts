import type { Request } from 'express';

import type { ProductScope, UpdateChannel, UpdatesPublishNotification } from './updates.interfaces';

export interface UpdatesModuleOptions {
  applicationId: ProductScope;
  productScope: ProductScope;
  serviceName: 'billing-manager' | 'agent-controller' | 'agent-manager' | 'control-plane';
  controllerPath: string;
  queueName: string;
  assertAdmin: (req: Request) => void;
  resolveScopeKey: () => string;
  github?: { owner?: string; repo?: string; tokenEnv?: string };
  versionEnv?: string;
  heartbeatIntervalMs?: number;
  publishNotification?: UpdatesPublishNotification;
  /** Optional scrape of remote instances before check (agenstra managers). */
  refreshRemoteInstances?: () => Promise<void>;
  /**
   * Release channel to follow (default `stable`): `beta` also announces GitHub prereleases. Evaluated on every check,
   * so a product can keep it in its own settings (Loadweaver: `Cluster.spec.updates.channel`).
   */
  resolveChannel?: () => UpdateChannel | Promise<UpdateChannel>;
  /** Override role detection; default QUEUE_ROLE or AGENT_MANAGER_ROLE or 'api'. */
  resolveServiceRole?: () => string;
}
