import { inject } from '@angular/core';
import { ENVIRONMENT, type LoadweaverConsoleEnvironment } from '@forepath/loadweaver/frontend/util-configuration';

/** Base for the console's REST services: the control plane's API URL from the (runtime) environment. */
export abstract class ConsoleApi {
  protected readonly environment = inject<LoadweaverConsoleEnvironment>(ENVIRONMENT);

  protected get apiUrl(): string {
    return this.environment.console.urls.restApi.replace(/\/$/, '');
  }

  protected url(path: string): string {
    return `${this.apiUrl}${path}`;
  }
}
