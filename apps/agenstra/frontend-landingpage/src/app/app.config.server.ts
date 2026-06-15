import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { ENVIRONMENT, environment } from '@forepath/shared/frontend/util-configuration';

import { appConfig } from './app.config';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(), { provide: ENVIRONMENT, useValue: environment }],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
