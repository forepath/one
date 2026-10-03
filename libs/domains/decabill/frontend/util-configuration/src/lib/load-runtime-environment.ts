import { createLoadRuntimeEnvironment } from '@forepath/shared/frontend/util-configuration';

import { environment } from './environment';

/** Bound to the build-time `environment` module (fileReplacement swaps console/landing/docs bases). */
export const loadRuntimeEnvironment = createLoadRuntimeEnvironment(environment);
