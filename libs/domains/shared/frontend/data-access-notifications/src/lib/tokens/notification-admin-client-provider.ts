import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

export interface NotificationAdminClientOption {
  id: string;
  label: string;
}

export interface NotificationAdminClientProvider {
  getClients(): Observable<NotificationAdminClientOption[]>;
}

/**
 * Optional provider for client options shown when {@link NotificationAdminEnvironment.clientFilterEnabled} is true.
 */
export const NOTIFICATION_ADMIN_CLIENT_PROVIDER = new InjectionToken<NotificationAdminClientProvider>(
  'NotificationAdminClientProvider',
);
