import type {
  AgentGraphAttrValue,
  AgentGraphBuildStatus,
  AgentGraphEdgeType,
  AgentGraphViewLayer,
  AgentGraphNodeType,
  AgentGraphReferenceKind,
} from '@forepath/agenstra/shared/util-opencode-config';

import { resolveAgentChatToolDisplay } from '../chat/agent-chat-tool-display';

/**
 * Bootstrap color token per node type. The canvas resolves the tokens with `getComputedStyle`, legends and chips use
 * `var(<token>)`, so light and dark themes share one mapping.
 */
const NODE_TYPE_COLOR_TOKENS: Record<AgentGraphNodeType, string> = {
  environment: '--bs-primary',
  instance: '--bs-pink',
  workspace: '--bs-indigo',
  module: '--bs-purple',
  file: '--bs-cyan',
  symbol: '--bs-teal',
  package: '--bs-green',
  doc: '--bs-pink',
  concept: '--bs-yellow',
  instruction: '--bs-orange',
  language: '--bs-red',
  directory: '--bs-gray-500',
  mount: '--bs-indigo',
  prompt: '--bs-orange',
  session: '--bs-yellow',
  ticket: '--bs-red',
  knowledge: '--bs-pink',
  'knowledge-folder': '--bs-purple',
  plan: '--bs-green',
  attachment: '--bs-teal',
  skill: '--bs-cyan',
  'mcp-server': '--bs-indigo',
  command: '--bs-gray-600',
  'agent-profile': '--bs-purple',
  plugin: '--bs-teal',
  tool: '--bs-blue',
};

/** Used when a token is not defined (or for unknown types). */
export const GRAPH_FALLBACK_COLOR = '#6c757d';

export function agentGraphNodeColorToken(type: string): string {
  return NODE_TYPE_COLOR_TOKENS[type as AgentGraphNodeType] ?? '--bs-secondary';
}

/** CSS color for templates (legend swatches, chips). */
export function agentGraphNodeColorCss(type: string): string {
  return `var(${agentGraphNodeColorToken(type)}, ${GRAPH_FALLBACK_COLOR})`;
}

const NODE_TYPE_ICONS: Record<AgentGraphNodeType, string> = {
  environment: 'cpu',
  instance: 'globe2',
  workspace: 'grid',
  module: 'boxes',
  file: 'file-earmark-code',
  symbol: 'braces',
  package: 'box-seam',
  doc: 'file-earmark-text',
  concept: 'lightbulb',
  instruction: 'journal-code',
  language: 'translate',
  directory: 'folder',
  mount: 'hdd-network',
  prompt: 'chat-left-text',
  session: 'chat-square-dots',
  ticket: 'kanban',
  knowledge: 'journal-richtext',
  'knowledge-folder': 'folder2',
  plan: 'list-check',
  attachment: 'paperclip',
  skill: 'stars',
  'mcp-server': 'plug',
  command: 'terminal',
  'agent-profile': 'person-badge',
  plugin: 'puzzle',
  tool: 'tools',
};

/** Bootstrap icon name (without `bi-`). */
export function agentGraphNodeIcon(type: string): string {
  return NODE_TYPE_ICONS[type as AgentGraphNodeType] ?? 'circle';
}

export function agentGraphNodeTypeLabel(type: string): string {
  switch (type as AgentGraphNodeType) {
    case 'environment':
      return $localize`:@@featureAgentGraphs-typeEnvironment:Environment`;
    case 'instance':
      return $localize`:@@featureAgentGraphs-typeInstance:Platform`;
    case 'workspace':
      return $localize`:@@featureAgentGraphs-typeWorkspace:Workspace`;
    case 'module':
      return $localize`:@@featureAgentGraphs-typeModule:Module`;
    case 'file':
      return $localize`:@@featureAgentGraphs-typeFile:File`;
    case 'symbol':
      return $localize`:@@featureAgentGraphs-typeSymbol:Symbol`;
    case 'package':
      return $localize`:@@featureAgentGraphs-typePackage:Package`;
    case 'doc':
      return $localize`:@@featureAgentGraphs-typeDoc:Document`;
    case 'concept':
      return $localize`:@@featureAgentGraphs-typeConcept:Concept`;
    case 'instruction':
      return $localize`:@@featureAgentGraphs-typeInstruction:Instruction`;
    case 'language':
      return $localize`:@@featureAgentGraphs-typeLanguage:Language`;
    case 'directory':
      return $localize`:@@featureAgentGraphs-typeDirectory:Directory`;
    case 'mount':
      return $localize`:@@featureAgentGraphs-typeMount:Mount`;
    case 'prompt':
      return $localize`:@@featureAgentGraphs-typePrompt:Prompt`;
    case 'session':
      return $localize`:@@featureAgentGraphs-typeSession:Session`;
    case 'ticket':
      return $localize`:@@featureAgentGraphs-typeTicket:Ticket`;
    case 'knowledge':
      return $localize`:@@featureAgentGraphs-typeKnowledge:Knowledge page`;
    case 'knowledge-folder':
      return $localize`:@@featureAgentGraphs-typeKnowledgeFolder:Knowledge folder`;
    case 'plan':
      return $localize`:@@featureAgentGraphs-typePlan:Plan`;
    case 'attachment':
      return $localize`:@@featureAgentGraphs-typeAttachment:Attachment`;
    case 'skill':
      return $localize`:@@featureAgentGraphs-typeSkill:Skill`;
    case 'mcp-server':
      return $localize`:@@featureAgentGraphs-typeMcpServer:MCP server`;
    case 'command':
      return $localize`:@@featureAgentGraphs-typeCommand:Command`;
    case 'agent-profile':
      return $localize`:@@featureAgentGraphs-typeAgentProfile:Agent profile`;
    case 'plugin':
      return $localize`:@@featureAgentGraphs-typePlugin:Plugin`;
    case 'tool':
      return $localize`:@@featureAgentGraphs-typeTool:Tool`;
    default:
      return type;
  }
}

export function agentGraphLayerLabel(layer: AgentGraphViewLayer): string {
  switch (layer) {
    case 'all':
      return $localize`:@@featureAgentGraphs-layerAll:All`;
    case 'knowledge':
      return $localize`:@@featureAgentGraphs-layerKnowledge:Knowledge`;
    case 'code':
      return $localize`:@@featureAgentGraphs-layerCode:Code`;
    case 'paths':
      return $localize`:@@featureAgentGraphs-layerPaths:Paths`;
    case 'references':
      return $localize`:@@featureAgentGraphs-layerReferences:Prompt references`;
  }
}

export function agentGraphStatusLabel(status: AgentGraphBuildStatus): string {
  switch (status) {
    case 'missing':
      return $localize`:@@featureAgentGraphs-statusMissing:Not built`;
    case 'building':
      return $localize`:@@featureAgentGraphs-statusBuilding:Building`;
    case 'ready':
      return $localize`:@@featureAgentGraphs-statusReady:Ready`;
    case 'stale':
      return $localize`:@@featureAgentGraphs-statusStale:Outdated`;
    case 'failed':
      return $localize`:@@featureAgentGraphs-statusFailed:Failed`;
  }
}

export function agentGraphStatusTone(
  status: AgentGraphBuildStatus,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'ready':
      return 'success';
    case 'building':
      return 'info';
    case 'stale':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const AGENT_GRAPH_REFERENCE_KINDS: readonly AgentGraphReferenceKind[] = [
  'attached',
  'available',
  'used',
  'modified',
];

export function agentGraphReferenceKindLabel(kind: AgentGraphReferenceKind): string {
  switch (kind) {
    case 'attached':
      return $localize`:@@featureAgentGraphs-kindAttached:Attached`;
    case 'available':
      return $localize`:@@featureAgentGraphs-kindAvailable:Available`;
    case 'used':
      return $localize`:@@featureAgentGraphs-kindUsed:Used`;
    case 'modified':
      return $localize`:@@featureAgentGraphs-kindModified:Modified`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Human-readable relations, attributes and tools (the graph data uses technical ids).
// ---------------------------------------------------------------------------------------------------------------------

/** Relation of the selected node to another node, phrased for its direction (`Contains` / `Part of`). */
export function agentGraphRelationLabel(type: string, direction: 'outgoing' | 'incoming'): string {
  const outgoing = direction === 'outgoing';

  switch (type as AgentGraphEdgeType) {
    case 'contains':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relContainsOut:Contains`
        : $localize`:@@featureAgentGraphs-relContainsIn:Part of`;
    case 'imports':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relImportsOut:Imports`
        : $localize`:@@featureAgentGraphs-relImportsIn:Imported by`;
    case 'depends_on':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relDependsOnOut:Depends on`
        : $localize`:@@featureAgentGraphs-relDependsOnIn:Required by`;
    case 'defines':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relDefinesOut:Defines`
        : $localize`:@@featureAgentGraphs-relDefinesIn:Defined in`;
    case 'links_to':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relLinksToOut:Links to`
        : $localize`:@@featureAgentGraphs-relLinksToIn:Linked from`;
    case 'documents':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relDocumentsOut:Describes`
        : $localize`:@@featureAgentGraphs-relDocumentsIn:Described in`;
    case 'written_in':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relWrittenInOut:Written in`
        : $localize`:@@featureAgentGraphs-relWrittenInIn:Language of`;
    case 'mounted_at':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relMountedAtOut:Shared with other environments at`
        : $localize`:@@featureAgentGraphs-relMountedAtIn:Shared folder of`;
    case 'attached':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relAttachedOut:Given as context`
        : $localize`:@@featureAgentGraphs-relAttachedIn:Given as context to`;
    case 'available':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relAvailableOut:Had available`
        : $localize`:@@featureAgentGraphs-relAvailableIn:Available to`;
    case 'used':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relUsedOut:Used`
        : $localize`:@@featureAgentGraphs-relUsedIn:Used by`;
    case 'modified':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relModifiedOut:Changed`
        : $localize`:@@featureAgentGraphs-relModifiedIn:Changed by`;
    case 'relates_to':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relRelatesToOut:Related to`
        : $localize`:@@featureAgentGraphs-relRelatesToIn:Related to`;
    case 'member_of':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relMemberOfOut:Member of`
        : $localize`:@@featureAgentGraphs-relMemberOfIn:Has member`;
    case 'references':
      return outgoing
        ? $localize`:@@featureAgentGraphs-relReferencesOut:Uses files of`
        : $localize`:@@featureAgentGraphs-relReferencesIn:Files used by`;
    default:
      return humanizeAgentGraphId(type);
  }
}

/** Attribute name (`fileCount` → `Files`); unknown names are humanized. */
export function agentGraphAttributeLabel(key: string): string {
  switch (key) {
    case 'language':
      return $localize`:@@featureAgentGraphs-attrLanguage:Language`;
    case 'size':
      return $localize`:@@featureAgentGraphs-attrSize:Size`;
    case 'bytes':
      return $localize`:@@featureAgentGraphs-attrBytes:Size`;
    case 'kind':
      return $localize`:@@featureAgentGraphs-attrKind:Kind`;
    case 'title':
      return $localize`:@@featureAgentGraphs-attrTitle:Title`;
    case 'manifest':
      return $localize`:@@featureAgentGraphs-attrManifest:Project file`;
    case 'ecosystems':
      return $localize`:@@featureAgentGraphs-attrEcosystems:Build system`;
    case 'files':
      return $localize`:@@featureAgentGraphs-attrFiles:Files`;
    case 'fileCount':
      return $localize`:@@featureAgentGraphs-attrFilecount:Files`;
    case 'exported':
      return $localize`:@@featureAgentGraphs-attrExported:Exported`;
    case 'line':
      return $localize`:@@featureAgentGraphs-attrLine:Line`;
    case 'level':
      return $localize`:@@featureAgentGraphs-attrLevel:Heading level`;
    case 'workingDirectory':
      return $localize`:@@featureAgentGraphs-attrWorkingdirectory:Working directory`;
    case 'mountPath':
      return $localize`:@@featureAgentGraphs-attrMountpath:Shared at`;
    case 'mountId':
      return $localize`:@@featureAgentGraphs-attrMountid:Shared folder`;
    case 'status':
      return $localize`:@@featureAgentGraphs-attrStatus:Status`;
    case 'root':
      return $localize`:@@featureAgentGraphs-attrRoot:Root folder`;
    case 'excluded':
      return $localize`:@@featureAgentGraphs-attrExcluded:Not indexed`;
    case 'readOnly':
      return $localize`:@@featureAgentGraphs-attrReadonly:Read-only`;
    case 'origin':
      return $localize`:@@featureAgentGraphs-attrOrigin:Started from`;
    case 'startedAt':
      return $localize`:@@featureAgentGraphs-attrStartedat:Started`;
    case 'builtAt':
      return $localize`:@@featureAgentGraphs-attrBuiltat:Graph built`;
    case 'priority':
      return $localize`:@@featureAgentGraphs-attrPriority:Priority`;
    case 'count':
      return $localize`:@@featureAgentGraphs-attrCount:Times`;
    case 'ecosystem':
      return $localize`:@@featureAgentGraphs-attrEcosystem:Build system`;
    default:
      return humanizeAgentGraphId(key);
  }
}

/** Attributes that only carry internal ids / bookkeeping and are not shown. */
export const AGENT_GRAPH_HIDDEN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'environmentId',
  'agentId',
  'clientId',
  'messageId',
  'managerKey',
  'referencedMountIds',
  'missing',
  'sha',
]);

function agentGraphKindLabel(value: string): string {
  switch (value) {
    case 'class':
      return $localize`:@@featureAgentGraphs-kindClass:Class`;
    case 'interface':
      return $localize`:@@featureAgentGraphs-kindInterface:Interface`;
    case 'type':
      return $localize`:@@featureAgentGraphs-kindType:Type`;
    case 'enum':
      return $localize`:@@featureAgentGraphs-kindEnum:Enumeration`;
    case 'function':
      return $localize`:@@featureAgentGraphs-kindFunction:Function`;
    case 'const':
      return $localize`:@@featureAgentGraphs-kindConst:Constant`;
    case 'struct':
      return $localize`:@@featureAgentGraphs-kindStruct:Structure`;
    case 'trait':
      return $localize`:@@featureAgentGraphs-kindTrait:Trait`;
    case 'module':
      return $localize`:@@featureAgentGraphs-kindModule:Module`;
    case 'component':
      return $localize`:@@featureAgentGraphs-kindComponent:Component`;
    case 'instructions':
      return $localize`:@@featureAgentGraphs-kindInstructions:Instructions`;
    case 'rule':
      return $localize`:@@featureAgentGraphs-kindRule:Rule`;
    case 'skill':
      return $localize`:@@featureAgentGraphs-kindSkill:Skill`;
    case 'command':
      return $localize`:@@featureAgentGraphs-kindCommand:Command`;
    default:
      return humanizeAgentGraphId(value);
  }
}

function agentGraphEcosystemLabel(value: string): string {
  switch (value) {
    case 'npm':
      return $localize`:@@featureAgentGraphs-ecosystemNpm:npm package`;
    case 'nx':
      return $localize`:@@featureAgentGraphs-ecosystemNx:Nx project`;
    case 'go':
      return $localize`:@@featureAgentGraphs-ecosystemGo:Go module`;
    case 'cargo':
      return $localize`:@@featureAgentGraphs-ecosystemCargo:Rust crate`;
    case 'python':
      return $localize`:@@featureAgentGraphs-ecosystemPython:Python package`;
    case 'composer':
      return $localize`:@@featureAgentGraphs-ecosystemComposer:PHP package`;
    case 'ruby':
      return $localize`:@@featureAgentGraphs-ecosystemRuby:Ruby gem`;
    case 'maven':
      return $localize`:@@featureAgentGraphs-ecosystemMaven:Maven project`;
    case 'gradle':
      return $localize`:@@featureAgentGraphs-ecosystemGradle:Gradle project`;
    case 'dotnet':
      return $localize`:@@featureAgentGraphs-ecosystemDotnet:.NET project`;
    case 'dart':
      return $localize`:@@featureAgentGraphs-ecosystemDart:Dart package`;
    case 'elixir':
      return $localize`:@@featureAgentGraphs-ecosystemElixir:Elixir project`;
    case 'tsconfig':
      return $localize`:@@featureAgentGraphs-ecosystemTsconfig:TypeScript configuration`;
    default:
      return humanizeAgentGraphId(value);
  }
}

function agentGraphOriginLabel(value: string): string {
  switch (value) {
    case 'chat':
      return $localize`:@@featureAgentGraphs-originChat:Chat`;
    case 'hidden':
      return $localize`:@@featureAgentGraphs-originHidden:Background run (task, handoff, plan)`;
    case 'ephemeral':
      return $localize`:@@featureAgentGraphs-originEphemeral:One-off prompt`;
    default:
      return humanizeAgentGraphId(value);
  }
}

/** Display names of the languages the scanners detect (product names, not translated). */
const AGENT_GRAPH_LANGUAGE_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  vue: 'Vue',
  svelte: 'Svelte',
  python: 'Python',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  scala: 'Scala',
  rust: 'Rust',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++',
  dart: 'Dart',
  elixir: 'Elixir',
  lua: 'Lua',
  shell: 'Shell',
  sql: 'SQL',
  markdown: 'Markdown',
  restructuredtext: 'reStructuredText',
  asciidoc: 'AsciiDoc',
  text: 'Text',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  gradle: 'Gradle',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  graphql: 'GraphQL',
  protobuf: 'Protocol Buffers',
  terraform: 'Terraform',
  dockerfile: 'Dockerfile',
  make: 'Makefile',
  groovy: 'Groovy',
};

export function agentGraphLanguageLabel(value: string): string {
  return AGENT_GRAPH_LANGUAGE_NAMES[value] ?? humanizeAgentGraphId(value);
}

/** Tool a prompt used (`apply_patch` → `Apply changes`, MCP tools by their server). */
export function agentGraphToolLabel(name: string): string {
  const tool = name.trim().toLowerCase();

  switch (tool) {
    case 'read':
      return $localize`:@@featureAgentGraphs-toolRead:Read file`;
    case 'view':
      return $localize`:@@featureAgentGraphs-toolView:Read file`;
    case 'write':
      return $localize`:@@featureAgentGraphs-toolWrite:Write file`;
    case 'edit':
      return $localize`:@@featureAgentGraphs-toolEdit:Edit file`;
    case 'multiedit':
      return $localize`:@@featureAgentGraphs-toolMultiedit:Edit file`;
    case 'patch':
      return $localize`:@@featureAgentGraphs-toolPatch:Apply changes`;
    case 'apply_patch':
      return $localize`:@@featureAgentGraphs-toolApplyPatch:Apply changes`;
    case 'grep':
      return $localize`:@@featureAgentGraphs-toolGrep:Search file contents`;
    case 'glob':
      return $localize`:@@featureAgentGraphs-toolGlob:Find files`;
    case 'list':
      return $localize`:@@featureAgentGraphs-toolList:List folder`;
    case 'ls':
      return $localize`:@@featureAgentGraphs-toolLs:List folder`;
    case 'bash':
      return $localize`:@@featureAgentGraphs-toolBash:Run command`;
    case 'task':
      return $localize`:@@featureAgentGraphs-toolTask:Delegate to an agent`;
    case 'skill':
      return $localize`:@@featureAgentGraphs-toolSkill:Use skill`;
    case 'webfetch':
      return $localize`:@@featureAgentGraphs-toolWebfetch:Fetch web page`;
    case 'todowrite':
      return $localize`:@@featureAgentGraphs-toolTodowrite:Update to-dos`;
    default:
      break;
  }

  // Platform tools (`agenstra_context_*`, `_content_*`, `_tasks_*`, `_handoff_*`, `_graph_*`): same names as in chats.
  if (tool.startsWith('agenstra_')) {
    return resolveAgentChatToolDisplay(tool).label;
  }

  return humanizeAgentGraphId(tool);
}

/** Formats a byte count (`12.3 kB`). */
export function formatAgentGraphBytes(bytes: number, locale: string): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }

  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

/**
 * Attribute value for people: Yes / No, sizes, dates, language / kind / build-system / origin names, statuses.
 * `formatDate` formats ISO timestamps in the page's locale.
 */
export function agentGraphAttributeValue(
  key: string,
  value: AgentGraphAttrValue,
  locale: string,
  formatDate: (value: string) => string,
): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (Array.isArray(value)) {
    return value.map((entry) => agentGraphAttributeValue(key, entry, locale, formatDate)).join(', ');
  }

  if (typeof value === 'boolean') {
    return value ? $localize`:@@featureAgentGraphs-yes:Yes` : $localize`:@@featureAgentGraphs-no:No`;
  }

  if (typeof value === 'number') {
    return key === 'size' || key === 'bytes'
      ? formatAgentGraphBytes(value, locale)
      : new Intl.NumberFormat(locale).format(value);
  }

  switch (key) {
    case 'language':
      return agentGraphLanguageLabel(value);
    case 'kind':
      return agentGraphKindLabel(value);
    case 'manifest':
    case 'ecosystem':
    case 'ecosystems':
      return agentGraphEcosystemLabel(value);
    case 'origin':
      return agentGraphOriginLabel(value);
    case 'status':
      return isAgentGraphBuildStatus(value) ? agentGraphStatusLabel(value) : humanizeAgentGraphId(value);
    case 'startedAt':
    case 'builtAt':
      return formatDate(value);
    case 'priority':
      return humanizeAgentGraphId(value);
    default:
      return value;
  }
}

/** Canvas / header label of a node: languages and tools by their readable names, everything else as recorded. */
export function agentGraphNodeDisplayLabel(node: { type: string; label: string }): string {
  if (node.type === 'instance') {
    return $localize`:@@featureAgentGraphs-allWorkspaces:All workspaces`;
  }

  if (node.type === 'language') {
    return agentGraphLanguageLabel(node.label);
  }

  if (node.type === 'tool') {
    return agentGraphToolLabel(node.label);
  }

  return node.label;
}

const AGENT_GRAPH_BUILD_STATUSES: readonly string[] = ['missing', 'building', 'ready', 'stale', 'failed'];

function isAgentGraphBuildStatus(value: string): value is AgentGraphBuildStatus {
  return AGENT_GRAPH_BUILD_STATUSES.includes(value);
}

/** `fileCount` / `depends_on` / `mcp-server` → `File count` / `Depends on` / `Mcp server`. */
export function humanizeAgentGraphId(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}
