import { AppCatalogsService } from './app-catalogs.service';
import { AppPlansService } from './app-plans.service';
import { APP_STORE_ENTITIES } from './app-store.entities';
import { AppStoreController } from './app-store.controller';

/** App store (P1): entities, controller and services of `app-store/`, registered by the control-plane module. */
export { APP_STORE_ENTITIES };

export const APP_STORE_CONTROLLERS = [AppStoreController];

export const APP_STORE_PROVIDERS = [AppCatalogsService, AppPlansService];
