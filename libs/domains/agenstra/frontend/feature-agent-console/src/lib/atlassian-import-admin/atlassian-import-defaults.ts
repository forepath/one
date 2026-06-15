/** Broad starter JQL; narrow with e.g. `project = KEY` as needed. */
export const DEFAULT_ATLASSIAN_JIRA_JQL = 'project IS NOT EMPTY ORDER BY updated DESC';

export const DEFAULT_ATLASSIAN_CONFLUENCE_CQL = 'type = page ORDER BY lastModified DESC';
