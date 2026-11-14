import { scanAgentGraphFile } from '../services/agent-graph-collector.service';

import {
  anchorAgentGraphLayerAtEnvironment,
  buildAgentGraphLayers,
  mergeAgentGraphLayers,
  type AgentGraphListedEntry,
  type AgentGraphParsedFile,
} from './agent-graph-builder.utils';
import {
  batchAgentGraphArchivePaths,
  buildAgentGraphArchiveCommand,
  buildAgentGraphListingCommand,
  parseAgentGraphArchive,
  parseAgentGraphListing,
} from './agent-graph-collect.utils';
import { AgentGraphIndex } from './agent-graph-index.utils';

function files(contents: Record<string, string>): {
  listing: AgentGraphListedEntry[];
  parsed: Record<string, AgentGraphParsedFile>;
} {
  const listing: AgentGraphListedEntry[] = Object.entries(contents).map(([path, content]) => ({
    path,
    kind: 'file',
    size: content.length,
    mtime: 1,
  }));
  const parsed = Object.fromEntries(
    Object.entries(contents).map(([path, content]) => [path, scanAgentGraphFile(path, content, content.length, 1)]),
  );

  return { listing, parsed };
}

describe('buildAgentGraphLayers', () => {
  const input = files({
    'package.json': '{"name":"root","dependencies":{"lodash":"4"}}',
    'tsconfig.json': '{"compilerOptions":{"paths":{"@lib/*":["packages/lib/src/*"]}}}',
    'AGENTS.md': '# Agent rules\nSee [docs](docs/guide.md).',
    'docs/guide.md': '# Guide\n## Setup\nStart in `apps/web/src/main.ts`.',
    'apps/web/package.json': '{"name":"web","dependencies":{"lib":"*","react":"18"}}',
    'apps/web/src/main.ts':
      "import { util } from '@lib/util';\nimport { App } from './app';\nimport React from 'react';\nexport function main() {}",
    'apps/web/src/app.ts': "import _ from 'lodash';\nexport class App {}",
    'packages/lib/package.json': '{"name":"lib"}',
    'packages/lib/src/util.ts': 'export const util = 1;',
  });
  const result = buildAgentGraphLayers({
    environmentName: 'env',
    workingDirectory: '/app',
    mountPath: '/opt/workspace/abc',
    listing: [...input.listing, { path: 'node_modules', kind: 'excluded' }],
    parsed: input.parsed,
  });
  const index = new AgentGraphIndex(result.code);
  const edge = (from: string, type: string, to: string) =>
    result.code.edges.some((entry) => entry.from === from && entry.type === type && entry.to === to);

  it('creates modules from manifests and nests them', () => {
    expect(index.getNode('module:.')?.label).toBe('root');
    expect(index.getNode('module:apps/web')?.label).toBe('web');
    expect(edge('module:.', 'contains', 'module:apps/web')).toBe(true);
    expect(edge('module:apps/web', 'contains', 'file:apps/web/src/main.ts')).toBe(true);
    expect(edge('module:apps/web', 'depends_on', 'module:packages/lib')).toBe(true);
    expect(edge('module:apps/web', 'depends_on', 'package:react')).toBe(true);
  });

  it('resolves relative, aliased and package imports', () => {
    expect(edge('file:apps/web/src/main.ts', 'imports', 'file:apps/web/src/app.ts')).toBe(true);
    expect(edge('file:apps/web/src/main.ts', 'imports', 'file:packages/lib/src/util.ts')).toBe(true);
    expect(edge('file:apps/web/src/main.ts', 'imports', 'package:react')).toBe(true);
    expect(edge('file:apps/web/src/app.ts', 'imports', 'package:lodash')).toBe(true);
    expect(edge('file:apps/web/src/app.ts', 'defines', 'symbol:apps/web/src/app.ts#App')).toBe(true);
  });

  it('links knowledge: instruction files, concepts, links and path mentions', () => {
    expect(index.getNode('file:AGENTS.md')?.type).toBe('instruction');
    expect(index.getNode('concept:docs/guide.md#setup')?.label).toBe('Setup');
    expect(edge('file:AGENTS.md', 'links_to', 'file:docs/guide.md')).toBe(true);
    expect(edge('file:docs/guide.md', 'documents', 'file:apps/web/src/main.ts')).toBe(true);
  });

  it('builds the paths layer with rolled-up sizes, excluded directories and the mount', () => {
    const paths = new AgentGraphIndex(result.paths);

    expect(paths.getNode('directory:.')?.attrs?.['files']).toBe(9);
    expect(paths.getNode('directory:apps/web')?.attrs?.['files']).toBe(3);
    expect(paths.getNode('directory:node_modules')?.attrs?.['excluded']).toBe(true);
    expect(paths.edgesOut('directory:.', 'mounted_at')[0]?.to).toBe('mount:self');
  });

  it('assigns communities and supports queries', () => {
    expect(result.code.nodes.every((node) => typeof node.community === 'number')).toBe(true);
    expect(index.search('main', 5)[0].node.id).toBe('symbol:apps/web/src/main.ts#main');
    expect(index.search('main.ts', 5)[0].node.id).toBe('file:apps/web/src/main.ts');
    expect(
      index.shortestPath('file:apps/web/src/app.ts', 'file:packages/lib/src/util.ts', 10)?.nodes.length,
    ).toBeGreaterThan(1);
    expect(index.neighborhood('file:apps/web/src/main.ts', 1, 3).nodes).toHaveLength(3);
    expect(index.slice(3).truncated).toBe(true);
    expect(index.hubs(3).length).toBeGreaterThan(0);
    expect(result.languages['typescript']).toBe(3);
  });
});

describe('mergeAgentGraphLayers (all layer)', () => {
  it('joins code, paths and references by node id and anchors them at the environment', () => {
    const input = files({ 'src/a.ts': "import './b';", 'src/b.ts': 'export const b = 1;' });
    const built = buildAgentGraphLayers({
      environmentName: 'env',
      workingDirectory: '/app',
      listing: input.listing,
      parsed: input.parsed,
    });
    const references = {
      nodes: [
        { id: 'session:s1', type: 'session' as const, label: 'Chat', community: 0 },
        { id: 'prompt:p1', type: 'prompt' as const, label: 'Fix it', community: 0 },
        { id: 'file:src/a.ts', type: 'file' as const, label: 'a.ts', community: 0 },
      ],
      edges: [
        { from: 'session:s1', to: 'prompt:p1', type: 'contains' as const },
        { from: 'prompt:p1', to: 'file:src/a.ts', type: 'used' as const },
      ],
    };
    const merged = new AgentGraphIndex(mergeAgentGraphLayers([built.code, built.paths], references));

    // One file node links its import, its directory and the prompt that used it.
    expect(merged.nodes.filter((n) => n.id === 'file:src/a.ts')).toHaveLength(1);
    expect(merged.edgesOut('file:src/a.ts', 'imports').map((e) => e.to)).toEqual(['file:src/b.ts']);
    expect(
      merged
        .edgesIn('file:src/a.ts')
        .map((e) => e.type)
        .sort(),
    ).toEqual(['contains', 'contains', 'used']);
    expect(merged.edgesOut('environment', 'contains').map((e) => e.to)).toEqual(
      expect.arrayContaining(['directory:.', 'session:s1']),
    );
    expect(merged.getNode('prompt:p1')?.community).toBeGreaterThan(0);
  });
});

describe('anchorAgentGraphLayerAtEnvironment (star topology)', () => {
  it('hangs the path tree and prompt sessions below the environment node', () => {
    const input = files({ 'src/a.ts': 'export const a = 1;' });
    const built = buildAgentGraphLayers({
      environmentName: 'env',
      workingDirectory: '/app',
      listing: input.listing,
      parsed: input.parsed,
    });
    const paths = new AgentGraphIndex(anchorAgentGraphLayerAtEnvironment(built.paths, { label: 'Frontend' }));

    expect(paths.getNode('environment')?.label).toBe('Frontend');
    expect(paths.edgesOut('environment', 'contains').map((e) => e.to)).toEqual(['directory:.']);

    const references = new AgentGraphIndex(
      anchorAgentGraphLayerAtEnvironment(
        {
          nodes: [
            { id: 'session:s1', type: 'session', label: 'Chat' },
            { id: 'prompt:p1', type: 'prompt', label: 'In chat' },
            { id: 'prompt:p2', type: 'prompt', label: 'Hidden run' },
            { id: 'file:a.ts', type: 'file', label: 'a.ts' },
          ],
          edges: [
            { from: 'session:s1', to: 'prompt:p1', type: 'contains' },
            { from: 'prompt:p1', to: 'file:a.ts', type: 'used' },
          ],
        },
        { label: 'Frontend' },
      ),
    );

    expect(
      references
        .edgesOut('environment', 'contains')
        .map((e) => e.to)
        .sort(),
    ).toEqual(['prompt:p2', 'session:s1']);
  });
});

describe('agent graph collection', () => {
  it('builds read-only worker commands with arguments, not interpolated paths', () => {
    const listing = buildAgentGraphListingCommand('/app', 10);

    expect(listing.slice(0, 2)).toEqual(['sh', '-c']);
    expect(listing.slice(-2)).toEqual(['/app', '10']);
    expect(listing[2]).toContain("-name 'node_modules'");

    const archive = buildAgentGraphArchiveCommand('/app', ['a b.ts', '-rf.ts']);

    expect(archive.slice(-2)).toEqual(['./a b.ts', './-rf.ts']);
    expect(archive[2]).toContain('tar -cf - --no-recursion -- "$@"');
  });

  it('parses NUL separated listings', () => {
    const output = Buffer.from('F\t12\t1700000000.5\tsrc/a.ts\0D\tsrc\0X\tnode_modules\0F\t1\t1\t../escape\0');

    expect(parseAgentGraphListing(output)).toEqual([
      { path: 'src/a.ts', kind: 'file', size: 12, mtime: 1700000000 },
      { path: 'src', kind: 'dir' },
      { path: 'node_modules', kind: 'excluded' },
    ]);
  });

  it('batches archive paths', () => {
    const batches = batchAgentGraphArchivePaths(Array.from({ length: 1200 }, (_, i) => `f${i}.ts`));

    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 200]);
  });

  it('reads regular members of a tar archive in memory and skips links, escapes and binaries', () => {
    const member = (name: string, content: string | Buffer, type = '0'): Buffer => {
      const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const header = Buffer.alloc(512);

      header.write(name, 0, 'utf8');
      header.write(data.length.toString(8).padStart(11, '0'), 124, 'ascii');
      header.write(type, 156, 'ascii');

      return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
    };
    const longName = `./${'d/'.repeat(60)}long.ts`;
    const archive = Buffer.concat([
      member('./src/a.ts', 'export const a = 1;'),
      member('./link.ts', '', '2'),
      member('../escape.ts', 'x'),
      member('./bin.dat', Buffer.from([1, 0, 2])),
      member('././@LongLink', longName, 'L'),
      member('ignored', 'long'),
      Buffer.alloc(1024),
    ]);
    const files = parseAgentGraphArchive(archive, 1024);

    expect([...files.keys()]).toEqual(['src/a.ts', `${'d/'.repeat(60)}long.ts`]);
    expect(files.get('src/a.ts')).toBe('export const a = 1;');
  });
});
