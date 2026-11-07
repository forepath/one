/** Socket.IO event names on the `initiatives` namespace (server → client). */
export const INITIATIVES_BOARD_EVENTS = {
  initiativeUpsert: 'initiativeUpsert',
  initiativeRemoved: 'initiativeRemoved',
  /** Document metadata + version (content is fetched over REST when a document is open and not being edited). */
  initiativeArtifactUpsert: 'initiativeArtifactUpsert',
  initiativeArtifactRemoved: 'initiativeArtifactRemoved',
  /** Changed work items (incl. effective statuses from linked tickets) and the tree version. */
  initiativeWorkItemsChanged: 'initiativeWorkItemsChanged',
  initiativeRunUpsert: 'initiativeRunUpsert',
  initiativeRunTurnAppended: 'initiativeRunTurnAppended',
  initiativeProposalUpsert: 'initiativeProposalUpsert',
  initiativeFindingUpsert: 'initiativeFindingUpsert',
  initiativeDecisionUpsert: 'initiativeDecisionUpsert',
  initiativeActivityCreated: 'initiativeActivityCreated',
} as const;

export type InitiativesBoardEvent = (typeof INITIATIVES_BOARD_EVENTS)[keyof typeof INITIATIVES_BOARD_EVENTS];
