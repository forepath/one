import { InitiativeActivityEntity } from './initiative-activity.entity';
import { InitiativeArtifactVersionEntity } from './initiative-artifact-version.entity';
import { InitiativeArtifactEntity } from './initiative-artifact.entity';
import { InitiativeChangeProposalEntity } from './initiative-change-proposal.entity';
import { InitiativeDecisionEntity } from './initiative-decision.entity';
import { InitiativeFindingEntity } from './initiative-finding.entity';
import { InitiativeRunTurnEntity } from './initiative-run-turn.entity';
import { InitiativeRunEntity } from './initiative-run.entity';
import { InitiativeUnknownEntity } from './initiative-unknown.entity';
import { InitiativeWorkItemDependencyEntity } from './initiative-work-item-dependency.entity';
import { InitiativeWorkItemEntity } from './initiative-work-item.entity';
import { InitiativeEntity } from './initiative.entity';

/** Every entity of the Initiatives feature (TypeORM registration in the module and the data source). */
export const INITIATIVE_ENTITIES = [
  InitiativeEntity,
  InitiativeArtifactEntity,
  InitiativeArtifactVersionEntity,
  InitiativeWorkItemEntity,
  InitiativeWorkItemDependencyEntity,
  InitiativeUnknownEntity,
  InitiativeRunEntity,
  InitiativeRunTurnEntity,
  InitiativeChangeProposalEntity,
  InitiativeDecisionEntity,
  InitiativeFindingEntity,
  InitiativeActivityEntity,
] as const;
