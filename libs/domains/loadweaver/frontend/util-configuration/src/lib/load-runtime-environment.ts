import { createLoadRuntimeEnvironment } from '@forepath/shared/frontend/util-configuration';

import { environment } from './environment';

/** Bound to the build-time `environment` module (fileReplacement swaps the development / production landing base). */
export const loadRuntimeEnvironment = createLoadRuntimeEnvironment(environment);
