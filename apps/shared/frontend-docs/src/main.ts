import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { ENVIRONMENT, loadRuntimeEnvironment } from './runtime-environment';

loadRuntimeEnvironment().then((environment) => {
  bootstrapApplication(AppComponent, {
    ...appConfig,
    providers: [
      ...appConfig.providers,
      {
        provide: ENVIRONMENT,
        useValue: environment,
      },
    ],
  }).catch((err) => console.error(err));
});
