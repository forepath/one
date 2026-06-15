import { KnowledgeActionType, KnowledgeActorType } from '../../entities/knowledge-node.enums';

export class KnowledgePageActivityResponseDto {
  id!: string;
  pageId!: string;
  occurredAt!: Date;
  actorType!: KnowledgeActorType;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actionType!: KnowledgeActionType;
  payload!: Record<string, unknown>;
}
