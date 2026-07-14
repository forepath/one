import type { Request } from 'express';

export type NotificationScopeMode = 'tenant_id' | 'instance';

export interface NotificationsModuleOptions {
  applicationId: string;
  eventCatalog: readonly string[];
  scopeMode: NotificationScopeMode;
  controllerPath: string;
  queueName: string;
  resolveScopeKey: () => string;
  assertAdmin: (req: Request) => void;
}
