export enum ExternalImportProviderId {
  ATLASSIAN = 'atlassian',
}

export enum ExternalImportKind {
  JIRA = 'jira',
  CONFLUENCE = 'confluence',
}

export enum ExternalImportMarkerType {
  JIRA_ISSUE = 'jira_issue',
  CONFLUENCE_PAGE = 'confluence_page',
  /** Wrapper folder for a Confluence page (holds the page node + child pages). */
  CONFLUENCE_PAGE_FOLDER = 'confluence_page_folder',
  /** Confluence native folder content type in the ancestor chain. */
  CONFLUENCE_NATIVE_FOLDER = 'confluence_native_folder',
}
