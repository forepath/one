/**
 * Lightweight, dependency-free source scanners for environment graphs. They read explicit structure only (import
 * statements, top-level declarations, Markdown headings / links) line by line; they never evaluate code. Results are
 * deliberately approximate: missing edges are expected, wrong ones should be rare.
 */

export type AgentGraphSymbolKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'const'
  | 'struct'
  | 'trait'
  | 'module'
  | 'component';

export interface AgentGraphScannedSymbol {
  name: string;
  kind: AgentGraphSymbolKind;
  exported: boolean;
  line: number;
}

export interface AgentGraphScannedImport {
  /** Raw specifier (`./a`, `react`, `os.path`, `github.com/x/y`, `crate::a::b`). */
  specifier: string;
  line: number;
}

export interface AgentGraphScannedSource {
  imports: AgentGraphScannedImport[];
  symbols: AgentGraphScannedSymbol[];
  /** Java / Kotlin / C# / PHP / Go package or namespace declaration. */
  namespace?: string;
}

export interface AgentGraphScannedHeading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface AgentGraphScannedDocument {
  title?: string;
  headings: AgentGraphScannedHeading[];
  /** Relative link targets (no URLs / anchors-only). */
  links: string[];
  /** Inline code spans that look like paths (`src/app.ts`). */
  pathMentions: string[];
}

const MAX_SYMBOLS_PER_FILE = 200;
const MAX_IMPORTS_PER_FILE = 300;
const MAX_LINES_SCANNED = 20_000;

/** Replace block comments with blanks (newlines kept, so line numbers stay correct). */
function stripBlockComments(source: string, open = '/*', close = '*/'): string {
  let result = '';
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf(open, index);

    if (start === -1) {
      result += source.slice(index);
      break;
    }

    const end = source.indexOf(close, start + open.length);

    result += source.slice(index, start);

    const comment = end === -1 ? source.slice(start) : source.slice(start, end + close.length);

    result += comment.replace(/[^\n]/g, ' ');
    index = end === -1 ? source.length : end + close.length;
  }

  return result;
}

function linesOf(source: string): string[] {
  const lines = source.split(/\r?\n/);

  return lines.length > MAX_LINES_SCANNED ? lines.slice(0, MAX_LINES_SCANNED) : lines;
}

class Collector {
  readonly imports: AgentGraphScannedImport[] = [];
  readonly symbols: AgentGraphScannedSymbol[] = [];
  private readonly seenImports = new Set<string>();
  private readonly seenSymbols = new Set<string>();
  namespace?: string;

  addImport(specifier: string | undefined, line: number): void {
    const value = specifier?.trim();

    if (!value || value.length > 300 || this.imports.length >= MAX_IMPORTS_PER_FILE || this.seenImports.has(value)) {
      return;
    }

    this.seenImports.add(value);
    this.imports.push({ specifier: value, line });
  }

  addSymbol(name: string | undefined, kind: AgentGraphSymbolKind, exported: boolean, line: number): void {
    const value = name?.trim();

    if (
      !value ||
      value.length > 120 ||
      !/^[A-Za-z_$][\w$]*$/.test(value) ||
      this.symbols.length >= MAX_SYMBOLS_PER_FILE ||
      this.seenSymbols.has(`${kind}:${value}`)
    ) {
      return;
    }

    this.seenSymbols.add(`${kind}:${value}`);
    this.symbols.push({ name: value, kind, exported, line });
  }

  result(): AgentGraphScannedSource {
    return { imports: this.imports, symbols: this.symbols, ...(this.namespace ? { namespace: this.namespace } : {}) };
  }
}

function scanJavaScriptLike(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(stripBlockComments(source));

  lines.forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, '');
    const lineNo = index + 1;

    for (const match of line.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      out.addImport(match[1], lineNo);
    }

    for (const match of line.matchAll(/^\s*import\s+['"]([^'"]+)['"]/g)) {
      out.addImport(match[1], lineNo);
    }

    for (const match of line.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      out.addImport(match[1], lineNo);
    }

    const declaration = line.match(
      /^\s*(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(class|interface|type|enum|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/,
    );

    if (declaration) {
      const keyword = declaration[2].replace('*', '');
      const kind: AgentGraphSymbolKind =
        keyword === 'class'
          ? 'class'
          : keyword === 'interface'
            ? 'interface'
            : keyword === 'type'
              ? 'type'
              : keyword === 'enum'
                ? 'enum'
                : keyword === 'function'
                  ? 'function'
                  : 'const';
      const exported = !!declaration[1];

      // Only top-level-ish consts (no indentation) or exported ones; locals would flood the graph.
      if (kind !== 'const' || exported || /^\S/.test(raw)) {
        out.addSymbol(declaration[3], kind, exported, lineNo);
      }
    }
  });

  return out.result();
}

function scanPython(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(source);

  lines.forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '');
    const lineNo = index + 1;
    const fromImport = line.match(/^\s*from\s+([.\w]+)\s+import\b/);

    if (fromImport) {
      out.addImport(fromImport[1], lineNo);
    } else {
      const plainImport = line.match(/^\s*import\s+(.+)$/);

      if (plainImport) {
        for (const part of plainImport[1].split(',')) {
          out.addImport(part.trim().split(/\s+as\s+/)[0], lineNo);
        }
      }
    }

    const declaration = line.match(/^(class|def|async\s+def)\s+([A-Za-z_]\w*)/);

    if (declaration) {
      const name = declaration[2];

      out.addSymbol(name, declaration[1] === 'class' ? 'class' : 'function', !name.startsWith('_'), lineNo);
    }
  });

  return out.result();
}

function scanGo(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(stripBlockComments(source));
  let inImportBlock = false;

  lines.forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, '');
    const lineNo = index + 1;
    const pkg = line.match(/^\s*package\s+(\w+)/);

    if (pkg) {
      out.namespace = pkg[1];
    }

    if (/^\s*import\s*\(/.test(line)) {
      inImportBlock = true;

      return;
    }

    if (inImportBlock) {
      if (/^\s*\)/.test(line)) {
        inImportBlock = false;

        return;
      }

      const spec = line.match(/"([^"]+)"/);

      out.addImport(spec?.[1], lineNo);

      return;
    }

    const single = line.match(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/);

    if (single) {
      out.addImport(single[1], lineNo);
    }

    const fn = line.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/);

    if (fn) {
      out.addSymbol(fn[1], 'function', /^[A-Z]/.test(fn[1]), lineNo);
    }

    const type = line.match(/^type\s+([A-Za-z_]\w*)\s+(struct|interface)?/);

    if (type) {
      out.addSymbol(
        type[1],
        type[2] === 'struct' ? 'struct' : type[2] === 'interface' ? 'interface' : 'type',
        /^[A-Z]/.test(type[1]),
        lineNo,
      );
    }
  });

  return out.result();
}

function scanJvm(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(stripBlockComments(source));

  lines.forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, '');
    const lineNo = index + 1;
    const pkg = line.match(/^\s*package\s+([\w.]+)/);

    if (pkg) {
      out.namespace = pkg[1];
    }

    const imp = line.match(/^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?/);

    if (imp) {
      out.addImport(imp[1], lineNo);
    }

    const declaration = line.match(
      /^\s*((?:public|internal|private|protected|abstract|final|open|sealed|data|static|inline|value|enum|annotation)\s+)*(class|interface|enum|object|record|fun|trait)\s+([A-Za-z_]\w*)/,
    );

    if (declaration) {
      const modifiers = declaration[1] ?? '';
      const keyword = declaration[2];
      const kind: AgentGraphSymbolKind =
        keyword === 'interface' || keyword === 'trait'
          ? 'interface'
          : keyword === 'enum'
            ? 'enum'
            : keyword === 'fun'
              ? 'function'
              : 'class';

      // Nested / member functions are skipped (indented `fun` in Kotlin classes).
      if (keyword !== 'fun' || /^\S/.test(raw)) {
        out.addSymbol(declaration[3], kind, !/\b(private|internal)\b/.test(modifiers), lineNo);
      }
    }
  });

  return out.result();
}

function scanRust(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(stripBlockComments(source));

  lines.forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, '');
    const lineNo = index + 1;
    const use = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/);

    if (use) {
      out.addImport(use[1].replace(/::$/, ''), lineNo);
    }

    const mod = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/);

    if (mod) {
      out.addImport(`mod:${mod[1]}`, lineNo);
    }

    const declaration = line.match(
      /^(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(fn|struct|enum|trait|type|const|static)\s+([A-Za-z_]\w*)/,
    );

    if (declaration) {
      const keyword = declaration[2];
      const kind: AgentGraphSymbolKind =
        keyword === 'fn'
          ? 'function'
          : keyword === 'struct'
            ? 'struct'
            : keyword === 'enum'
              ? 'enum'
              : keyword === 'trait'
                ? 'trait'
                : keyword === 'type'
                  ? 'type'
                  : 'const';

      out.addSymbol(declaration[3], kind, !!declaration[1], lineNo);
    }
  });

  return out.result();
}

function scanCSharp(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(stripBlockComments(source));

  lines.forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, '');
    const lineNo = index + 1;
    const ns = line.match(/^\s*namespace\s+([\w.]+)/);

    if (ns) {
      out.namespace = ns[1];
    }

    const using = line.match(/^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/);

    if (using) {
      out.addImport(using[1], lineNo);
    }

    const declaration = line.match(
      /^\s*((?:public|internal|private|protected|abstract|sealed|static|partial|readonly|record)\s+)*(class|interface|enum|struct|record)\s+([A-Za-z_]\w*)/,
    );

    if (declaration) {
      const keyword = declaration[2];

      out.addSymbol(
        declaration[3],
        keyword === 'interface' ? 'interface' : keyword === 'enum' ? 'enum' : keyword === 'struct' ? 'struct' : 'class',
        /\bpublic\b/.test(declaration[1] ?? ''),
        lineNo,
      );
    }
  });

  return out.result();
}

function scanPhp(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(stripBlockComments(source));

  lines.forEach((raw, index) => {
    const line = raw.replace(/(\/\/|#).*$/, '');
    const lineNo = index + 1;
    const ns = line.match(/^\s*namespace\s+([\w\\]+)/);

    if (ns) {
      out.namespace = ns[1];
    }

    const use = line.match(/^\s*use\s+([\w\\]+)/);

    if (use) {
      out.addImport(use[1], lineNo);
    }

    const include = line.match(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/);

    if (include) {
      out.addImport(include[1], lineNo);
    }

    const declaration = line.match(
      /^\s*(?:abstract\s+|final\s+)?(class|interface|trait|enum|function)\s+([A-Za-z_]\w*)/,
    );

    if (declaration) {
      const keyword = declaration[1];

      out.addSymbol(
        declaration[2],
        keyword === 'interface'
          ? 'interface'
          : keyword === 'trait'
            ? 'trait'
            : keyword === 'enum'
              ? 'enum'
              : keyword === 'function'
                ? 'function'
                : 'class',
        true,
        lineNo,
      );
    }
  });

  return out.result();
}

function scanRuby(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(stripBlockComments(source, '=begin', '=end'));

  lines.forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '');
    const lineNo = index + 1;
    const req = line.match(/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/);

    if (req) {
      out.addImport(line.includes('require_relative') ? `./${req[1].replace(/^\.\//, '')}` : req[1], lineNo);
    }

    const declaration = line.match(/^\s*(class|module|def)\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/);

    if (declaration) {
      out.addSymbol(
        declaration[2].replace(/[?!]$/, ''),
        declaration[1] === 'class' ? 'class' : declaration[1] === 'module' ? 'module' : 'function',
        true,
        lineNo,
      );
    }
  });

  return out.result();
}

function scanCLike(source: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(stripBlockComments(source));

  lines.forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, '');
    const lineNo = index + 1;
    const include = line.match(/^\s*#\s*include\s+["<]([^">]+)[">]/);

    if (include) {
      out.addImport(line.includes('"') ? `./${include[1]}` : include[1], lineNo);
    }

    const declaration = line.match(/^(?:class|struct|enum|union)\s+([A-Za-z_]\w*)/);

    if (declaration) {
      out.addSymbol(
        declaration[1],
        line.startsWith('enum') ? 'enum' : line.startsWith('class') ? 'class' : 'struct',
        true,
        lineNo,
      );
    }
  });

  return out.result();
}

function scanSwiftDartElixirLua(source: string, language: string): AgentGraphScannedSource {
  const out = new Collector();
  const lines = linesOf(language === 'lua' ? source : stripBlockComments(source));

  lines.forEach((raw, index) => {
    const line = raw.replace(language === 'elixir' ? /#.*$/ : language === 'lua' ? /--.*$/ : /\/\/.*$/, '');
    const lineNo = index + 1;
    let match: RegExpMatchArray | null;

    if (language === 'swift' && (match = line.match(/^\s*import\s+(\w+)/))) {
      out.addImport(match[1], lineNo);
    } else if (language === 'dart' && (match = line.match(/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/))) {
      out.addImport(match[1], lineNo);
    } else if (language === 'elixir' && (match = line.match(/^\s*(?:alias|import|use|require)\s+([\w.]+)/))) {
      out.addImport(match[1], lineNo);
    } else if (language === 'lua' && (match = line.match(/\brequire\s*\(?\s*['"]([^'"]+)['"]/))) {
      out.addImport(match[1], lineNo);
    }

    if (
      (match = line.match(
        /^\s*(?:public\s+|open\s+|final\s+)*(class|struct|protocol|enum|extension|mixin)\s+([A-Za-z_]\w*)/,
      ))
    ) {
      out.addSymbol(
        match[2],
        match[1] === 'protocol'
          ? 'interface'
          : match[1] === 'enum'
            ? 'enum'
            : match[1] === 'struct'
              ? 'struct'
              : 'class',
        true,
        lineNo,
      );
    } else if (language === 'elixir' && (match = line.match(/^\s*defmodule\s+([\w.]+)/))) {
      out.addSymbol(match[1].split('.').pop(), 'module', true, lineNo);
    } else if ((match = line.match(/^(?:func|function|local\s+function)\s+([A-Za-z_]\w*)/))) {
      out.addSymbol(match[1], 'function', !line.startsWith('local'), lineNo);
    }
  });

  return out.result();
}

function scanShell(source: string): AgentGraphScannedSource {
  const out = new Collector();

  linesOf(source).forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '');
    const lineNo = index + 1;
    const sourced = line.match(/^\s*(?:source|\.)\s+["']?([^\s"'$]+)["']?/);

    if (sourced && !sourced[1].startsWith('/')) {
      out.addImport(sourced[1].startsWith('.') ? sourced[1] : `./${sourced[1]}`, lineNo);
    }

    const fn = line.match(/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/);

    if (fn) {
      out.addSymbol(fn[1].replace(/-/g, '_'), 'function', true, lineNo);
    }
  });

  return out.result();
}

/** Vue / Svelte single-file components: scan the `<script>` blocks as JS/TS and add the component itself. */
function scanSingleFileComponent(source: string): AgentGraphScannedSource {
  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join('\n');

  return scanJavaScriptLike(scripts);
}

export function scanAgentGraphSource(language: string, source: string): AgentGraphScannedSource {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return scanJavaScriptLike(source);
    case 'vue':
    case 'svelte':
      return scanSingleFileComponent(source);
    case 'python':
      return scanPython(source);
    case 'go':
      return scanGo(source);
    case 'java':
    case 'kotlin':
    case 'scala':
      return scanJvm(source);
    case 'rust':
      return scanRust(source);
    case 'csharp':
      return scanCSharp(source);
    case 'php':
      return scanPhp(source);
    case 'ruby':
      return scanRuby(source);
    case 'c':
    case 'cpp':
      return scanCLike(source);
    case 'swift':
    case 'dart':
    case 'elixir':
    case 'lua':
      return scanSwiftDartElixirLua(source, language);
    case 'shell':
      return scanShell(source);
    default:
      return { imports: [], symbols: [] };
  }
}

export function slugifyAgentGraphHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

const MAX_HEADINGS_PER_DOC = 120;
const MAX_LINKS_PER_DOC = 200;

/** Markdown (and similar) structure: title, headings, relative links, inline path mentions. */
export function scanAgentGraphDocument(source: string): AgentGraphScannedDocument {
  const headings: AgentGraphScannedHeading[] = [];
  const links = new Set<string>();
  const pathMentions = new Set<string>();
  let inFence = false;
  let title: string | undefined;
  const lines = linesOf(source);
  // Front matter (`---` … `---`) may carry a title / name (skills, rules).
  let index = 0;

  if (lines[0]?.trim() === '---') {
    for (index = 1; index < lines.length && index < 60; index++) {
      if (lines[index].trim() === '---') {
        index++;
        break;
      }

      const field = lines[index].match(/^(?:title|name):\s*["']?(.+?)["']?\s*$/);

      if (field && !title) {
        title = field[1];
      }
    }
  }

  for (; index < lines.length; index++) {
    const line = lines[index];

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);

    if (heading && headings.length < MAX_HEADINGS_PER_DOC) {
      const text = heading[2].trim();

      headings.push({ level: heading[1].length, text, slug: slugifyAgentGraphHeading(text), line: index + 1 });

      if (!title && heading[1].length === 1) {
        title = text;
      }
    }

    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];

      if (links.size < MAX_LINKS_PER_DOC && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#')) {
        links.add(target.split('#')[0]);
      }
    }

    for (const match of line.matchAll(/`([A-Za-z0-9_.\-/]+\/[A-Za-z0-9_.\-/]*\.[A-Za-z0-9]{1,8})`/g)) {
      if (pathMentions.size < MAX_LINKS_PER_DOC) {
        pathMentions.add(match[1]);
      }
    }
  }

  return {
    ...(title ? { title } : {}),
    headings,
    links: [...links].filter(Boolean),
    pathMentions: [...pathMentions],
  };
}
