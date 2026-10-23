import { inject } from '@angular/core';
import { ENVIRONMENT, type LoadweaverConsoleEnvironment } from '@forepath/loadweaver/frontend/util-configuration';

import { ConsoleEndpointService } from './console-endpoint.service';

/**
 * Base for the console's REST services: the control plane's API URL from the (runtime) environment, or in fleet mode
 * the fleet's relay for the active cluster (`ConsoleEndpointService`), so every view works through the fleet as is.
 */
export abstract class ConsoleApi {
  protected readonly environment = inject<LoadweaverConsoleEnvironment>(ENVIRONMENT);
  protected readonly endpoints = inject(ConsoleEndpointService);

  protected get apiUrl(): string {
    return this.endpoints.restApi();
  }

  protected url(path: string): string {
    return `${this.apiUrl}${path}`;
  }
}
