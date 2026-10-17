import { AutoscaleStateEntity } from './autoscale-state.entity';
import { AutoscalerService } from './autoscaler.service';
import { AutoscalingController } from './autoscaling.controller';

/** Horizontal autoscaling (3.23): entities, controllers and services of `autoscaling/`, registered by the module. */
export const AUTOSCALING_ENTITIES = [AutoscaleStateEntity];

export const AUTOSCALING_CONTROLLERS = [AutoscalingController];

export const AUTOSCALING_PROVIDERS = [AutoscalerService];
