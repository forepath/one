/** Socket.IO event names on the `pages` namespace (server → client). */
export const KNOWLEDGE_BOARD_EVENTS = {
  knowledgeTreeChanged: 'knowledgeTreeChanged',
  knowledgeRelationChanged: 'knowledgeRelationChanged',
  knowledgePageActivityCreated: 'knowledgePageActivityCreated',
} as const;
