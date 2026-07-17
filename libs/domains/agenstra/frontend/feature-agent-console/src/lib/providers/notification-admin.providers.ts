import { inject } from '@angular/core';
import { ClientsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  NOTIFICATION_ADMIN_CLIENT_PROVIDER,
  type NotificationAdminClientProvider,
} from '@forepath/shared/frontend/data-access-notifications';
import { map } from 'rxjs';

export function provideAgenstraNotificationAdminClientProvider(): {
  provide: typeof NOTIFICATION_ADMIN_CLIENT_PROVIDER;
  useFactory: () => NotificationAdminClientProvider;
} {
  return {
    provide: NOTIFICATION_ADMIN_CLIENT_PROVIDER,
    useFactory: () => {
      const clientsFacade = inject(ClientsFacade);

      return {
        getClients: () =>
          clientsFacade.clients$.pipe(
            map((clients) => clients.map((client) => ({ id: client.id, label: client.name }))),
          ),
      };
    },
  };
}
