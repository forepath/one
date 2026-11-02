#!/usr/bin/env node
// One data-list pattern (loadweaver.md 3.38 D1–D4): record collections are `fpc-data-table`s.
// Fails when the removed list components come back or `fpc-list-item` shows up outside the allowed
// keep-cases (navigation, search results, one-control settings rows, chat, agent-config form arrays,
// lane cards of the ticket boards, import per-row editors, draft tray). Usage: node tools/ci/check-data-lists.mjs
import { execSync } from 'node:child_process';

const ALLOWED_LIST_ITEM = new Set([
  'libs/domains/agenstra/frontend/feature-agent-config/src/lib/agent-config-editor/agent-config-editor.component.html',
  'libs/domains/agenstra/frontend/feature-agent-config/src/lib/map-list/agent-config-map-list.component.ts',
  'libs/domains/agenstra/frontend/feature-agent-config/src/lib/path-list/agent-config-path-list.component.ts',
  'libs/domains/agenstra/frontend/feature-agent-console/src/lib/chat/agent-chat-tool-embed.component.html',
  'libs/domains/agenstra/frontend/feature-agent-console/src/lib/chat/chat.component.html',
  'libs/domains/agenstra/frontend/feature-agent-console/src/lib/file-editor/workspace-search-panel/workspace-search-panel.component.html',
  'libs/domains/agenstra/frontend/feature-agent-console/src/lib/tickets/tickets-board.component.html',
  'libs/domains/decabill/frontend/feature-billing-console/src/lib/project-board/project-board.component.html',
  'libs/domains/identity/frontend/feature-auth/src/lib/settings/security/security-settings.component.html',
  'libs/domains/loadweaver/frontend/feature-console/src/lib/container/container.component.html',
  'libs/domains/loadweaver/frontend/feature-console/src/lib/import/import-page.component.html',
  'libs/domains/loadweaver/frontend/feature-console/src/lib/nav/draft-tray.component.ts',
  'libs/domains/loadweaver/frontend/feature-console/src/lib/search/search-results.component.html',
  'libs/domains/loadweaver/frontend/feature-console/src/lib/topology/topology-map.component.html',
  'libs/domains/shared/frontend/feature-docs/src/lib/pages/docs-search-page/docs-search-page.component.html',
]);
const REMOVED =
  /<fpc-pagination|FpcPaginationComponent|fpcInfiniteScroll|FpcInfiniteScrollDirective|fpc-list-append-footer|FpcListAppendFooterComponent/;

const files = execSync(
  "git ls-files -co --exclude-standard 'libs/domains/*.html' 'libs/domains/*.ts'",
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(
    (file) =>
      file &&
      !/\.(spec|stories)\.ts$/.test(file) &&
      !file.includes('/ui-components/') &&
      !file.includes('feature-landingpage'),
  );
const problems = [];

for (const file of files) {
  let text;

  try {
    text = (await import('node:fs')).readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (REMOVED.test(text))
    problems.push(
      `${file}: uses a removed list component (use fpc-data-table paging / fpc-pager)`,
    );
  if (text.includes('<fpc-list-item') && !ALLOWED_LIST_ITEM.has(file))
    problems.push(
      `${file}: fpc-list-item for a record collection? Use fpc-data-table (or add a justified keep-case here)`,
    );
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log(`data lists ok (${files.length} files)`);
