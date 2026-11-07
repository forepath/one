/** Server → client events of the `initiatives` namespace (mirror of the controller's INITIATIVES_BOARD_EVENTS). */
export const INITIATIVES_BOARD_SOCKET_EVENTS = {
  initiativeUpsert: 'initiativeUpsert',
  initiativeRemoved: 'initiativeRemoved',
  initiativeArtifactUpsert: 'initiativeArtifactUpsert',
  initiativeArtifactRemoved: 'initiativeArtifactRemoved',
  initiativeWorkItemsChanged: 'initiativeWorkItemsChanged',
  initiativeRunUpsert: 'initiativeRunUpsert',
  initiativeRunTurnAppended: 'initiativeRunTurnAppended',
  initiativeProposalUpsert: 'initiativeProposalUpsert',
  initiativeFindingUpsert: 'initiativeFindingUpsert',
  initiativeDecisionUpsert: 'initiativeDecisionUpsert',
  initiativeActivityCreated: 'initiativeActivityCreated',
} as const;
