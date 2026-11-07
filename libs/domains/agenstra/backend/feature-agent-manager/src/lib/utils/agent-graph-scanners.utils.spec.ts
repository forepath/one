import { scanAgentGraphDocument, scanAgentGraphSource } from './agent-graph-scanners.utils';
import { parseAgentGraphManifest } from './agent-graph-manifests.utils';
import {
  agentGraphInstructionKindOf,
  agentGraphLanguageOf,
  isAgentGraphSensitiveFile,
  normalizeAgentGraphRelativePath,
  shouldParseAgentGraphFile,
} from './agent-graph-files.utils';

describe('agent graph scanners', () => {
  it('extracts TypeScript imports and top-level declarations', () => {
    const result = scanAgentGraphSource(
      'typescript',
      [
        "import { a } from './a';",
        "import type { B } from '@scope/pkg/sub';",
        "import './side-effect';",
        "const lazy = await import('../lazy');",
        '/* import { ignored } from "nope"; */',
        '// import { alsoIgnored } from "nope";',
        'export class Foo {}',
        'export interface Bar {}',
        'export type Baz = string;',
        'export async function run() {}',
        'export const VALUE = 1;',
        'function local() {',
        '  const inner = 2;',
        '}',
      ].join('\n'),
    );

    expect(result.imports.map((entry) => entry.specifier)).toEqual([
      './a',
      '@scope/pkg/sub',
      './side-effect',
      '../lazy',
    ]);
    expect(result.symbols.map((symbol) => [symbol.name, symbol.kind, symbol.exported])).toEqual([
      ['lazy', 'const', false],
      ['Foo', 'class', true],
      ['Bar', 'interface', true],
      ['Baz', 'type', true],
      ['run', 'function', true],
      ['VALUE', 'const', true],
      ['local', 'function', false],
    ]);
  });

  it('extracts Python, Go, Rust and Java structure', () => {
    expect(
      scanAgentGraphSource(
        'python',
        'from .models import User\nimport os, sys as system\nclass Api:\n    pass\ndef _hidden():\n    pass',
      ).imports.map((entry) => entry.specifier),
    ).toEqual(['.models', 'os', 'sys']);

    const go = scanAgentGraphSource(
      'go',
      'package api\n\nimport (\n  "fmt"\n  x "example.com/m/internal/x"\n)\n\nfunc Serve() {}\ntype Server struct {}',
    );

    expect(go.namespace).toBe('api');
    expect(go.imports.map((entry) => entry.specifier)).toEqual(['fmt', 'example.com/m/internal/x']);
    expect(go.symbols.map((symbol) => symbol.name)).toEqual(['Serve', 'Server']);

    const rust = scanAgentGraphSource('rust', 'mod db;\nuse crate::db::pool;\npub struct App;\nfn private() {}');

    expect(rust.imports.map((entry) => entry.specifier)).toEqual(['mod:db', 'crate::db::pool']);
    expect(rust.symbols.map((symbol) => [symbol.name, symbol.exported])).toEqual([
      ['App', true],
      ['private', false],
    ]);

    const java = scanAgentGraphSource('java', 'package com.acme;\nimport com.acme.util.Strings;\npublic class Main {}');

    expect(java.namespace).toBe('com.acme');
    expect(java.imports[0].specifier).toBe('com.acme.util.Strings');
    expect(java.symbols[0]).toMatchObject({ name: 'Main', kind: 'class', exported: true });
  });

  it('reads Markdown headings, relative links and path mentions outside code fences', () => {
    const doc = scanAgentGraphDocument(
      [
        '---',
        'name: Deploy skill',
        '---',
        '# Title',
        'See [setup](./setup.md#install) and [web](https://x.y).',
        '```',
        '# not a heading',
        '```',
        '## Usage',
        'Edit `src/app/main.ts`.',
      ].join('\n'),
    );

    expect(doc.title).toBe('Deploy skill');
    expect(doc.headings.map((heading) => [heading.level, heading.slug])).toEqual([
      [1, 'title'],
      [2, 'usage'],
    ]);
    expect(doc.links).toEqual(['./setup.md']);
    expect(doc.pathMentions).toEqual(['src/app/main.ts']);
  });
});

describe('agent graph manifests', () => {
  it('parses npm, go, cargo, python and tsconfig manifests', () => {
    expect(
      parseAgentGraphManifest(
        'package.json',
        '{"name":"@a/web","dependencies":{"react":"1"},"devDependencies":{"jest":"1"}}',
      ),
    ).toEqual({
      ecosystem: 'npm',
      name: '@a/web',
      dependencies: ['react', 'jest'],
    });
    expect(
      parseAgentGraphManifest('svc/go.mod', 'module example.com/m\n\nrequire (\n\tgithub.com/x/y v1.0.0\n)\n'),
    ).toMatchObject({
      name: 'example.com/m',
      dependencies: ['github.com/x/y'],
    });
    expect(
      parseAgentGraphManifest('Cargo.toml', '[package]\nname = "app"\n[dependencies]\nserde = "1"\n'),
    ).toMatchObject({
      name: 'app',
      dependencies: ['serde'],
    });
    expect(
      parseAgentGraphManifest('requirements.txt', '# c\nDjango>=4\n-r other.txt\nrequests\n')?.dependencies,
    ).toEqual(['django', 'requests']);
    expect(
      parseAgentGraphManifest(
        'tsconfig.json',
        '{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/app/*"] } }, }',
      )?.pathAliases,
    ).toEqual({ '@app/*': ['src/app/*'] });
    expect(parseAgentGraphManifest('README.md', '')).toBeUndefined();
  });
});

describe('agent graph file rules', () => {
  it('classifies languages, instructions and sensitive files', () => {
    expect(agentGraphLanguageOf('src/a.tsx')).toBe('typescript');
    expect(agentGraphLanguageOf('Dockerfile.api')).toBe('dockerfile');
    expect(agentGraphInstructionKindOf('AGENTS.md')).toBe('instructions');
    expect(agentGraphInstructionKindOf('.cursor/rules/x.mdc')).toBe('rule');
    expect(agentGraphInstructionKindOf('.opencode/skills/deploy/SKILL.md')).toBe('skill');
    expect(isAgentGraphSensitiveFile('config/.env.production')).toBe(true);
    expect(isAgentGraphSensitiveFile('keys/server.pem')).toBe(true);
    expect(isAgentGraphSensitiveFile('src/token.service.ts')).toBe(false);
    expect(shouldParseAgentGraphFile('.env', 10, 1000)).toBe(false);
    expect(shouldParseAgentGraphFile('src/a.ts', 10, 1000)).toBe(true);
    expect(shouldParseAgentGraphFile('src/a.ts', 2000, 1000)).toBe(false);
    expect(shouldParseAgentGraphFile('image.png', 10, 1000)).toBe(false);
  });

  it('normalizes relative paths and rejects escapes', () => {
    expect(normalizeAgentGraphRelativePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeAgentGraphRelativePath('src//b/../a.ts')).toBe('src/a.ts');
    expect(normalizeAgentGraphRelativePath('../etc/passwd')).toBeUndefined();
    expect(normalizeAgentGraphRelativePath('/etc/passwd')).toBeUndefined();
    expect(normalizeAgentGraphRelativePath('a\0b')).toBeUndefined();
  });
});
