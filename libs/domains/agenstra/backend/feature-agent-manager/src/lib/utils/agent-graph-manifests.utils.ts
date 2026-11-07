import { posix } from 'node:path';

/**
 * Manifest parsing for environment graphs: every manifest directory becomes a module (package / project / crate /
 * Go module ...) with its declared dependencies. Text-level parsing only; malformed manifests yield what was found.
 */

export type AgentGraphManifestEcosystem =
  | 'npm'
  | 'nx'
  | 'go'
  | 'cargo'
  | 'python'
  | 'composer'
  | 'ruby'
  | 'maven'
  | 'gradle'
  | 'dotnet'
  | 'dart'
  | 'elixir'
  | 'tsconfig';

export interface AgentGraphManifest {
  ecosystem: AgentGraphManifestEcosystem;
  /** Declared module / package name (npm name, Go module path, crate name, artifactId, ...). */
  name?: string;
  dependencies: string[];
  /** tsconfig `compilerOptions.paths` aliases (`@app/*` → `src/app/*`), relative to the manifest directory. */
  pathAliases?: Record<string, string[]>;
}

const MAX_DEPENDENCIES = 400;

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].slice(0, MAX_DEPENDENCIES);
}

/** JSON with comments / trailing commas (tsconfig, project.json) tolerated. */
function parseLooseJson(source: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch {
    try {
      const cleaned = source
        .replace(
          /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
          (match, quoted: string | undefined) => quoted ?? '',
        )
        .replace(/,(\s*[}\]])/g, '$1');

      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}

function objectKeys(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as object) : [];
}

function parsePackageJson(source: string): AgentGraphManifest {
  const json = parseLooseJson(source) ?? {};

  return {
    ecosystem: 'npm',
    ...(typeof json['name'] === 'string' ? { name: json['name'] } : {}),
    dependencies: unique([
      ...objectKeys(json['dependencies']),
      ...objectKeys(json['devDependencies']),
      ...objectKeys(json['peerDependencies']),
      ...objectKeys(json['optionalDependencies']),
    ]),
  };
}

function parseProjectJson(source: string): AgentGraphManifest {
  const json = parseLooseJson(source) ?? {};
  const implicit = Array.isArray(json['implicitDependencies'])
    ? (json['implicitDependencies'] as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];

  return {
    ecosystem: 'nx',
    ...(typeof json['name'] === 'string' ? { name: json['name'] } : {}),
    dependencies: unique(implicit.filter((value) => !value.startsWith('!'))),
  };
}

function parseTsconfig(source: string): AgentGraphManifest {
  const json = parseLooseJson(source) ?? {};
  const compilerOptions = (json['compilerOptions'] ?? {}) as Record<string, unknown>;
  const rawPaths = (compilerOptions['paths'] ?? {}) as Record<string, unknown>;
  const baseUrl = typeof compilerOptions['baseUrl'] === 'string' ? compilerOptions['baseUrl'] : '.';
  const pathAliases: Record<string, string[]> = {};

  for (const [alias, targets] of Object.entries(rawPaths).slice(0, 500)) {
    if (Array.isArray(targets)) {
      pathAliases[alias] = targets
        .filter((target): target is string => typeof target === 'string')
        .map((target) => posix.normalize(posix.join(baseUrl, target)));
    }
  }

  return { ecosystem: 'tsconfig', dependencies: [], pathAliases };
}

function parseGoMod(source: string): AgentGraphManifest {
  const name = source.match(/^\s*module\s+(\S+)/m)?.[1];
  const dependencies: string[] = [];
  let inRequire = false;

  for (const line of source.split(/\r?\n/)) {
    if (/^\s*require\s*\(/.test(line)) {
      inRequire = true;
      continue;
    }

    if (inRequire && /^\s*\)/.test(line)) {
      inRequire = false;
      continue;
    }

    const single = line.match(/^\s*require\s+(\S+)\s+\S+/);
    const entry = inRequire ? line.match(/^\s*(\S+)\s+v\S+/) : single;

    if (entry) {
      dependencies.push(entry[1]);
    }
  }

  return { ecosystem: 'go', ...(name ? { name } : {}), dependencies: unique(dependencies) };
}

/** Minimal TOML section reader (`[section]` → `key = value` lines). */
function tomlSections(source: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = '';

  for (const line of source.split(/\r?\n/)) {
    const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);

    if (header) {
      current = header[1];
      continue;
    }

    if (!sections.has(current)) {
      sections.set(current, []);
    }

    sections.get(current)?.push(line);
  }

  return sections;
}

function tomlKeys(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/)?.[1])
    .filter((key): key is string => !!key);
}

function tomlString(lines: string[] | undefined, key: string): string | undefined {
  for (const line of lines ?? []) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`));

    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function parseCargoToml(source: string): AgentGraphManifest {
  const sections = tomlSections(source);
  const name = tomlString(sections.get('package'), 'name');

  return {
    ecosystem: 'cargo',
    ...(name ? { name } : {}),
    dependencies: unique([
      ...tomlKeys(sections.get('dependencies')),
      ...tomlKeys(sections.get('dev-dependencies')),
      ...tomlKeys(sections.get('build-dependencies')),
    ]),
  };
}

function pythonRequirementName(value: string): string | undefined {
  const name = value
    .trim()
    .replace(/^["']|["'],?$/g, '')
    .match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1];

  return name?.toLowerCase();
}

function parsePyproject(source: string): AgentGraphManifest {
  const sections = tomlSections(source);
  const name = tomlString(sections.get('project'), 'name') ?? tomlString(sections.get('tool.poetry'), 'name');
  const dependencies: string[] = [
    ...tomlKeys(sections.get('tool.poetry.dependencies')).filter((key) => key !== 'python'),
  ];
  const projectBlock = sections.get('project')?.join('\n') ?? '';
  const arrayMatch = projectBlock.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);

  if (arrayMatch) {
    for (const entry of arrayMatch[1].split(/,\s*\n|\n/)) {
      const dependency = pythonRequirementName(entry);

      if (dependency) {
        dependencies.push(dependency);
      }
    }
  }

  return { ecosystem: 'python', ...(name ? { name } : {}), dependencies: unique(dependencies) };
}

function parseRequirementsTxt(source: string): AgentGraphManifest {
  return {
    ecosystem: 'python',
    dependencies: unique(
      source
        .split(/\r?\n/)
        .filter((line) => !/^\s*(#|-)/.test(line))
        .map(pythonRequirementName)
        .filter((name): name is string => !!name),
    ),
  };
}

function parseSetupPy(source: string): AgentGraphManifest {
  const name = source.match(/\bname\s*=\s*["']([^"']+)["']/)?.[1];
  const requires = source.match(/install_requires\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';

  return {
    ecosystem: 'python',
    ...(name ? { name } : {}),
    dependencies: unique(
      [...requires.matchAll(/["']([^"']+)["']/g)].map((match) => pythonRequirementName(match[1]) ?? ''),
    ),
  };
}

function parseComposerJson(source: string): AgentGraphManifest {
  const json = parseLooseJson(source) ?? {};

  return {
    ecosystem: 'composer',
    ...(typeof json['name'] === 'string' ? { name: json['name'] } : {}),
    dependencies: unique(
      [...objectKeys(json['require']), ...objectKeys(json['require-dev'])].filter(
        (dependency) => dependency !== 'php' && !dependency.startsWith('ext-'),
      ),
    ),
  };
}

function parseGemfile(source: string): AgentGraphManifest {
  return {
    ecosystem: 'ruby',
    dependencies: unique([...source.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((match) => match[1])),
  };
}

function parsePomXml(source: string): AgentGraphManifest {
  const withoutParent = source.replace(/<parent>[\s\S]*?<\/parent>/, '');
  const withoutDependencies = withoutParent.replace(/<dependencies>[\s\S]*?<\/dependencies>/g, '');
  const name = withoutDependencies.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1];
  const dependencies = [
    ...source.matchAll(
      /<dependency>[\s\S]*?<groupId>\s*([^<\s]+)\s*<\/groupId>[\s\S]*?<artifactId>\s*([^<\s]+)\s*<\/artifactId>[\s\S]*?<\/dependency>/g,
    ),
  ].map((match) => `${match[1]}:${match[2]}`);

  return { ecosystem: 'maven', ...(name ? { name } : {}), dependencies: unique(dependencies) };
}

function parseGradle(source: string): AgentGraphManifest {
  const dependencies = [
    ...source.matchAll(
      /\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|kapt|ksp)\s*\(?\s*["']([^"':]+:[^"':]+)(?::[^"']*)?["']/g,
    ),
  ].map((match) => match[1]);
  const projects = [...source.matchAll(/project\(\s*["']:?([^"']+)["']\s*\)/g)].map((match) => `project:${match[1]}`);

  return { ecosystem: 'gradle', dependencies: unique([...dependencies, ...projects]) };
}

function parseCsproj(source: string): AgentGraphManifest {
  const packages = [...source.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((match) => match[1]);
  const projects = [...source.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)].map(
    (match) => `project:${match[1].replace(/\\/g, '/')}`,
  );
  const name = source.match(/<AssemblyName>\s*([^<\s]+)\s*<\/AssemblyName>/)?.[1];

  return { ecosystem: 'dotnet', ...(name ? { name } : {}), dependencies: unique([...packages, ...projects]) };
}

function parsePubspec(source: string): AgentGraphManifest {
  const name = source.match(/^name:\s*(\S+)/m)?.[1];
  const dependencies: string[] = [];
  let inDependencies = false;

  for (const line of source.split(/\r?\n/)) {
    if (/^(dev_)?dependencies:\s*$/.test(line)) {
      inDependencies = true;
      continue;
    }

    if (/^\S/.test(line)) {
      inDependencies = false;
    }

    const entry = inDependencies ? line.match(/^ {2}([A-Za-z0-9_]+):/) : null;

    if (entry) {
      dependencies.push(entry[1]);
    }
  }

  return { ecosystem: 'dart', ...(name ? { name } : {}), dependencies: unique(dependencies) };
}

function parseMixExs(source: string): AgentGraphManifest {
  const name = source.match(/app:\s*:(\w+)/)?.[1];

  return {
    ecosystem: 'elixir',
    ...(name ? { name } : {}),
    dependencies: unique([...source.matchAll(/\{\s*:(\w+)\s*,/g)].map((match) => match[1])),
  };
}

/** Parse a manifest by file name; `undefined` for unknown names. */
export function parseAgentGraphManifest(relativePath: string, source: string): AgentGraphManifest | undefined {
  const name = posix.basename(relativePath).toLowerCase();

  switch (name) {
    case 'package.json':
      return parsePackageJson(source);
    case 'project.json':
      return parseProjectJson(source);
    case 'tsconfig.json':
      return parseTsconfig(source);
    case 'go.mod':
      return parseGoMod(source);
    case 'cargo.toml':
      return parseCargoToml(source);
    case 'pyproject.toml':
      return parsePyproject(source);
    case 'requirements.txt':
    case 'pipfile':
      return parseRequirementsTxt(source);
    case 'setup.py':
    case 'setup.cfg':
      return parseSetupPy(source);
    case 'composer.json':
      return parseComposerJson(source);
    case 'gemfile':
      return parseGemfile(source);
    case 'pom.xml':
      return parsePomXml(source);
    case 'build.gradle':
    case 'build.gradle.kts':
    case 'settings.gradle':
    case 'settings.gradle.kts':
      return parseGradle(source);
    case 'pubspec.yaml':
      return parsePubspec(source);
    case 'mix.exs':
      return parseMixExs(source);
    default:
      return name.endsWith('.csproj') ? parseCsproj(source) : undefined;
  }
}
