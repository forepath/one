import type { Request } from 'express';
import type { EmailSubjectRegistry } from '@forepath/shared/backend/util-email';

export type NotificationScopeMode = 'tenant_id' | 'instance';

export interface NotificationsEmailOptions {
  templateRoots: string[];
  emailEventCatalog: readonly string[];
  subjectRegistry: EmailSubjectRegistry;
  /** Shown in the email layout header (invoice-style company name). */
  companyName?: string;
  /** Invoice-style "From" block shown in the email layout footer. */
  companyFrom?: {
    name: string;
    lines: string[];
    vatId?: string;
    email?: string;
  };
}

export interface NotificationsModuleOptions {
  applicationId: string;
  eventCatalog: readonly string[];
  scopeMode: NotificationScopeMode;
  controllerPath: string;
  queueName: string;
  resolveScopeKey: () => string;
  assertAdmin: (req: Request) => void;
  email?: NotificationsEmailOptions;
}
