import { bootstrapApplication } from '@angular/platform-browser';
import { ENVIRONMENT, loadRuntimeEnvironment } from '@forepath/shared/frontend/util-configuration';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

loadRuntimeEnvironment().then((runtimeEnvironment) => {
  bootstrapApplication(AppComponent, {
    ...appConfig,
    providers: [
      ...appConfig.providers,
      {
        provide: ENVIRONMENT,
        useValue: runtimeEnvironment,
      },
    ],
  }).catch((err) => console.error(err));
});
