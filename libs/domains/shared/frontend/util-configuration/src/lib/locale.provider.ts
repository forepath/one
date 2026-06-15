import { PLATFORM_ID, Provider } from '@angular/core';

import { ENVIRONMENT } from './environment.token';
import { LocaleService } from './locale.service';

export function provideLocale(): Provider[] {
  return [
    {
      provide: LocaleService,
      useClass: LocaleService,
      deps: [ENVIRONMENT, PLATFORM_ID],
    },
  ];
}
