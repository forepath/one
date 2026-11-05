export { OpenSearchModule } from './lib/opensearch.module';
export { OpenSearchService } from './lib/opensearch.service';
export {
  buildOpenSearchIndexName,
  readOpenSearchConnectionConfig,
  type OpenSearchConnectionConfig,
} from './lib/opensearch-connection.config';
export { buildScopedSearchBody, clampSearchPagination, sanitizeSearchQuery } from './lib/opensearch-query.util';
export {
  OPENSEARCH_DEFAULT_PAGE_SIZE,
  OPENSEARCH_MAX_PAGE_SIZE,
  OPENSEARCH_MAX_QUERY_LENGTH,
  type OpenSearchBulkUpsertItem,
  type OpenSearchDocument,
  type OpenSearchSearchHit,
  type OpenSearchSearchParams,
  type OpenSearchSearchResult,
} from './lib/opensearch.types';
export { SEARCH_NOTIFICATION_EVENTS, type SearchNotificationEventType } from './lib/search-notification.events';
