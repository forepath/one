import { posix } from 'node:path';

/**
 * File classification for environment graphs: which directories are walked, which files are parsed, and which
 * languages they are written in. Pure (no I/O) so the same rules apply to listings and archive entries.
 */

/** Directories never walked (dependencies, build output, caches, VCS internals). Listed as excluded leaves. */
export const AGENT_GRAPH_EXCLUDED_DIRECTORIES = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'jspm_packages',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.nx',
  '.angular',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.gradle',
  '.idea',
  'bin',
  'obj',
  '.terraform',
  'tmp',
] as const;

const EXCLUDED_DIRECTORY_SET = new Set<string>(AGENT_GRAPH_EXCLUDED_DIRECTORIES);

/**
 * Files whose content is never read (credentials / secrets). They still appear in the paths layer by name, like in a
 * directory listing, but nothing of their content reaches the graph.
 */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|asc|gpg|kdbx)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /secret/i,
  /credential/i,
  /^\.?(tokens?|passwords?)(\.(json|txt|ya?ml))?$/i,
  /^\.(npmrc|pypirc|netrc|git-credentials|dockercfg)$/i,
  /^auth\.json$/i,
  /^\.htpasswd$/i,
  /\.tfstate(\.backup)?$/i,
  /\.tfvars$/i,
];

export function isAgentGraphExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORY_SET.has(name);
}

export function isAgentGraphSensitiveFile(relativePath: string): boolean {
  const name = posix.basename(relativePath);

  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/** Language of a source file by extension / name; `undefined` for files that are not parsed as code. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  svelte: 'svelte',
  py: 'python',
  pyi: 'python',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  rs: 'rust',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  lua: 'lua',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  mdc: 'markdown',
  rst: 'restructuredtext',
  adoc: 'asciidoc',
  txt: 'text',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  gradle: 'gradle',
  csproj: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  tf: 'terraform',
};

const LANGUAGE_BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
  gemfile: 'ruby',
  rakefile: 'ruby',
  jenkinsfile: 'groovy',
};

export function agentGraphLanguageOf(relativePath: string): string | undefined {
  const name = posix.basename(relativePath).toLowerCase();

  if (LANGUAGE_BY_NAME[name]) {
    return LANGUAGE_BY_NAME[name];
  }

  if (name.startsWith('dockerfile')) {
    return 'dockerfile';
  }

  const dot = name.lastIndexOf('.');

  return dot > 0 ? LANGUAGE_BY_EXTENSION[name.slice(dot + 1)] : undefined;
}

/** Languages whose files are scanned for imports / symbols. */
export const AGENT_GRAPH_CODE_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'vue',
  'svelte',
  'python',
  'go',
  'java',
  'kotlin',
  'scala',
  'rust',
  'csharp',
  'php',
  'ruby',
  'swift',
  'c',
  'cpp',
  'dart',
  'elixir',
  'lua',
  'shell',
]);

/** Markup / documentation languages parsed for headings and links. */
export const AGENT_GRAPH_DOC_LANGUAGES = new Set(['markdown', 'restructuredtext', 'asciidoc']);

/** Manifest file names parsed for modules and dependencies. */
export const AGENT_GRAPH_MANIFEST_NAMES = new Set([
  'package.json',
  'project.json',
  'go.mod',
  'cargo.toml',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'pipfile',
  'composer.json',
  'gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'pubspec.yaml',
  'mix.exs',
  'tsconfig.json',
]);

export function isAgentGraphManifest(relativePath: string): boolean {
  const name = posix.basename(relativePath).toLowerCase();

  return AGENT_GRAPH_MANIFEST_NAMES.has(name) || name.endsWith('.csproj');
}

/**
 * Agent instruction / context files that tools load implicitly (AGENTS.md, CLAUDE.md, rules, skills, prompts).
 * Returns the kind (used as node attr) or `undefined`.
 */
export function agentGraphInstructionKindOf(relativePath: string): string | undefined {
  const lower = relativePath.toLowerCase();
  const name = posix.basename(lower);

  if (
    ['agents.md', 'claude.md', 'gemini.md', 'copilot-instructions.md', '.cursorrules', '.windsurfrules'].includes(name)
  ) {
    return 'instructions';
  }

  if (
    /(^|\/)\.(cursor|agenstra|opencode|claude|windsurf|clinerules|github)\/rules?\//.test(lower) ||
    name.endsWith('.mdc')
  ) {
    return 'rule';
  }

  if (/(^|\/)(\.opencode|\.claude|\.agenstra|\.cursor)\/skills?\//.test(lower) || name === 'skill.md') {
    return 'skill';
  }

  if (/(^|\/)(\.opencode|\.claude|\.agenstra)\/(commands?|agents?|prompts?)\//.test(lower)) {
    return 'command';
  }

  if (/(^|\/)\.github\/(instructions|prompts)\//.test(lower)) {
    return 'instructions';
  }

  return undefined;
}

/** Whether a listed file's content is streamed out of the worker and parsed. */
export function shouldParseAgentGraphFile(relativePath: string, size: number, maxBytes: number): boolean {
  if (size <= 0 || size > maxBytes || isAgentGraphSensitiveFile(relativePath)) {
    return false;
  }

  if (isAgentGraphManifest(relativePath) || agentGraphInstructionKindOf(relativePath)) {
    return true;
  }

  const language = agentGraphLanguageOf(relativePath);

  return !!language && (AGENT_GRAPH_CODE_LANGUAGES.has(language) || AGENT_GRAPH_DOC_LANGUAGES.has(language));
}

/** Normalize an archive / listing path to a clean relative POSIX path; `undefined` when it escapes the root. */
export function normalizeAgentGraphRelativePath(raw: string): string | undefined {
  if (typeof raw !== 'string' || !raw || raw.includes('\0')) {
    return undefined;
  }

  const stripped = raw.replace(/^(\.\/)+/, '');

  if (!stripped || stripped.startsWith('/')) {
    return undefined;
  }

  const normalized = posix.normalize(stripped).replace(/\/+$/, '');

  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }

  return normalized;
}
