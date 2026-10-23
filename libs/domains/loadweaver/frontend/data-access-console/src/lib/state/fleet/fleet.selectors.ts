import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleFleetState } from './fleet.reducer';

export const selectConsoleFleetState = createFeatureSelector<ConsoleFleetState>('consoleFleet');

const pick = <K extends keyof ConsoleFleetState>(key: K) =>
  createSelector(selectConsoleFleetState, (state) => state[key]);

export const selectFleetClusters = pick('clusters');
export const selectFleetClustersLoaded = pick('clustersLoaded');
export const selectFleetClustersLoading = pick('clustersLoading');
export const selectFleetClustersError = pick('clustersError');
export const selectFleetSaving = pick('saving');
export const selectFleetSaveError = pick('saveError');
export const selectFleetTesting = pick('testing');
export const selectFleetTestResult = pick('testResult');
export const selectFleetTestError = pick('testError');
export const selectFleetPolling = pick('polling');
export const selectFleetPollError = pick('pollError');

export const selectFleetGrantsClusterId = pick('grantsClusterId');
export const selectFleetGrants = pick('grants');
export const selectFleetGrantsLoading = pick('grantsLoading');
export const selectFleetGrantsError = pick('grantsError');
export const selectFleetGrantSaving = pick('grantSaving');
export const selectFleetGrantError = pick('grantError');

export const selectFleetCards = pick('cards');
export const selectFleetCardsLoading = pick('cardsLoading');
export const selectFleetCardsError = pick('cardsError');
export const selectFleetInbox = pick('inbox');
export const selectFleetInboxLoading = pick('inboxLoading');
export const selectFleetInboxError = pick('inboxError');
export const selectFleetSites = pick('sites');
export const selectFleetSitesLoading = pick('sitesLoading');
export const selectFleetSitesError = pick('sitesError');

export const selectFleetComparison = pick('comparison');
export const selectFleetComparisonLoading = pick('comparisonLoading');
export const selectFleetComparisonError = pick('comparisonError');

export const selectFleetOperationsCluster = pick('operationsCluster');
export const selectFleetOperations = pick('operations');
export const selectFleetOperationsLoading = pick('operationsLoading');
export const selectFleetOperationsError = pick('operationsError');
export const selectFleetOperationSaving = pick('operationSaving');
export const selectFleetOperationError = pick('operationError');
export const selectFleetCancelling = pick('cancelling');
/** Operations still in flight (the page refreshes while there are any). */
export const selectFleetHasActiveOperations = createSelector(selectFleetOperations, (operations) =>
  operations.some((o) => o.status === 'running' || o.status === 'waiting'),
);

export const selectFleetCloudStatus = pick('cloudStatus');
export const selectFleetCloudErrors = pick('cloudErrors');

export const selectFleetAuditEntries = pick('auditEntries');
export const selectFleetAuditPage = pick('auditPage');
export const selectFleetAuditHasNext = pick('auditHasNext');
export const selectFleetAuditHasPrevious = createSelector(selectConsoleFleetState, (state) => state.auditPage > 0);
export const selectFleetAuditLoading = pick('auditLoading');
export const selectFleetAuditError = pick('auditError');
export const selectFleetAuditLimit = pick('auditLimit');

/** Overview summary: clusters by connection state, open inbox items, clusters with an upgrade or in teardown. */
export const selectFleetSummary = createSelector(selectFleetCards, selectFleetInbox, (cards, inbox) => ({
  clusters: cards.length,
  healthy: cards.filter((c) => c.connection.state === 'healthy').length,
  unhealthy: cards.filter((c) => c.connection.state !== 'healthy').length,
  critical: inbox.filter((i) => i.severity === 'critical').length,
  attention: inbox.length,
  upgrades: cards.filter((c) => c.upgradeAvailable).length,
  pendingPlans: cards.reduce((sum, c) => sum + (c.pendingPlans ?? 0), 0),
  openAlerts: cards.reduce((sum, c) => sum + (c.openAlerts ?? 0), 0),
  teardown: cards.filter((c) => c.state === 'teardown').length,
}));
