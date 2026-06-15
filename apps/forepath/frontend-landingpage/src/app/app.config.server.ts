import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { ENVIRONMENT, environment } from '@forepath/shared/frontend/util-configuration';

import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes)), { provide: ENVIRONMENT, useValue: environment }],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
