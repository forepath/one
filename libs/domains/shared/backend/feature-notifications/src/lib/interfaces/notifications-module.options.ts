import type { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import type { EmailSubjectRegistry } from '@forepath/shared/backend/util-email';

import type { EmailCompanyFrom } from '../email/resolve-email-company-name';

export type NotificationScopeMode = 'tenant_id' | 'instance';

export interface NotificationsEmailOptions {
  templateRoots: string[];
  emailEventCatalog: readonly string[];
  subjectRegistry: EmailSubjectRegistry;
  /**
   * Brand name for the email header. Prefer a getter so env is read after bootstrap.
   */
  resolveCompanyName?: () => string;
  /**
   * Invoice-style "From" footer. Prefer a getter so env is read after bootstrap.
   */
  resolveCompanyFrom?: () => EmailCompanyFrom | undefined;
}

export interface NotificationsModuleOptions {
  applicationId: string;
  eventCatalog: readonly string[];
  scopeMode: NotificationScopeMode;
  controllerPath: string;
  queueName: string;
  resolveScopeKey: () => string;
  /** Throws unless the caller may manage webhook endpoints; may resolve app services through `moduleRef`. */
  assertAdmin: (req: Request, moduleRef: ModuleRef) => void | Promise<void>;
  email?: NotificationsEmailOptions;
}
