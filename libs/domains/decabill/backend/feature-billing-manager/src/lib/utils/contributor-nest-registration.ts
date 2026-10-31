import type { Type } from '@nestjs/common';

import { CONTAINER_MANAGER_NEST_REGISTRATION } from '../contributors/container-manager/container-manager.contributor.module';
import { AGENSTRA_CONTROLLER_NEST_REGISTRATION } from '../contributors/agenstra-controller/agenstra-controller.contributor.module';
import { AGENSTRA_MANAGER_NEST_REGISTRATION } from '../contributors/agenstra-manager/agenstra-manager.contributor.module';
import { DECABILL_BILLING_NEST_REGISTRATION } from '../contributors/decabill-billing/decabill-billing.contributor.module';
import { DIGITAL_OCEAN_NEST_REGISTRATION } from '../contributors/digital-ocean/digital-ocean.contributor.module';
import { HETZNER_NEST_REGISTRATION } from '../contributors/hetzner/hetzner.contributor.module';
import { LOADWEAVER_NEST_REGISTRATION } from '../contributors/loadweaver/loadweaver.contributor.module';
import { LOADWEAVER_USAGE_NEST_REGISTRATION } from '../contributors/loadweaver-usage/loadweaver-usage.contributor.module';
import { registerContributorNestModules, type RegisteredContributorNestModule } from './contributor-nest.types';

const FIRST_PARTY_CONTRIBUTOR_NEST_REGISTRATIONS: RegisteredContributorNestModule[] = [
  HETZNER_NEST_REGISTRATION,
  DIGITAL_OCEAN_NEST_REGISTRATION,
  CONTAINER_MANAGER_NEST_REGISTRATION,
  AGENSTRA_CONTROLLER_NEST_REGISTRATION,
  AGENSTRA_MANAGER_NEST_REGISTRATION,
  DECABILL_BILLING_NEST_REGISTRATION,
  LOADWEAVER_NEST_REGISTRATION,
  LOADWEAVER_USAGE_NEST_REGISTRATION,
];

export function resolveContributorNestImports(extra: RegisteredContributorNestModule[] = []): Type<unknown>[] {
  return registerContributorNestModules([...FIRST_PARTY_CONTRIBUTOR_NEST_REGISTRATIONS, ...extra]);
}
