import { collectToolIdentifiers, linkToolUsage, projectJsonReferencesIdentifier } from './link-tool-usage';
import type { ProjectGraph } from '@nx/devkit';

describe('collectToolIdentifiers', () => {
  it('should include project name, dirname, package name, and unscoped segment', () => {
    expect(
      collectToolIdentifiers({
        projectName: 'sbom',
        dirName: 'sbom',
        packageName: '@forepath/sbom',
      }).sort(),
    ).toEqual(['@forepath/sbom', 'sbom']);
  });

  it('should work without a scoped forepath prefix', () => {
    expect(
      collectToolIdentifiers({
        projectName: 'releaser',
        packageName: 'acme-releaser',
      }).sort(),
    ).toEqual(['acme-releaser', 'releaser']);
  });
});

describe('projectJsonReferencesIdentifier', () => {
  it('should match scoped package names and executor plugin ids', () => {
    expect(
      projectJsonReferencesIdentifier(
        `{ "targets": { "sbom": { "executor": "@forepath/sbom:sbom" } } }`,
        '@forepath/sbom',
      ),
    ).toBe(true);
    expect(
      projectJsonReferencesIdentifier(
        `{ "targets": { "sbom": { "executor": "acme-releaser:run" } } }`,
        'acme-releaser',
      ),
    ).toBe(true);
    expect(
      projectJsonReferencesIdentifier(`{ "targets": { "sbom": { "executor": "@forepath/sbom:sbom" } } }`, 'sbom'),
    ).toBe(true);
  });

  it('should match implicitDependencies and tools/ paths, not bare ambiguous tokens', () => {
    expect(projectJsonReferencesIdentifier(`{ "implicitDependencies": ["code"] }`, 'code')).toBe(true);
    expect(
      projectJsonReferencesIdentifier(
        `{ "targets": { "x": { "options": { "command": "bash tools/ci/script.sh" } } } }`,
        'ci',
      ),
    ).toBe(true);
    expect(projectJsonReferencesIdentifier(`{ "targets": { "test": { "configurations": { "ci": {} } } } }`, 'ci')).toBe(
      false,
    );
  });
});

describe('linkToolUsage', () => {
  it('should emit depends_on from consumer projects to matched tools', () => {
    const dir = require('os').tmpdir();
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const root = fs.mkdtempSync(path.join(dir, 'kg-tool-usage-'));
    fs.mkdirSync(path.join(root, 'apps/demo-api'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'apps/demo-api/project.json'),
      JSON.stringify({
        name: 'demo-api',
        targets: { sbom: { executor: '@company/sbom:sbom' } },
      }),
    );

    const projectGraph = {
      nodes: {
        'demo-api': {
          name: 'demo-api',
          type: 'app',
          data: { root: 'apps/demo-api', projectType: 'application', tags: [], targets: {} },
        },
        sbom: {
          name: 'sbom',
          type: 'lib',
          data: { root: 'tools/sbom', projectType: 'library', tags: [], targets: {} },
        },
      },
      dependencies: {},
    } as unknown as ProjectGraph;

    const result = linkToolUsage({
      projectGraph,
      workspaceRoot: root,
      tools: [
        {
          toolNodeId: 'project:sbom',
          identifiers: ['@company/sbom', 'sbom'],
        },
      ],
    });

    expect(result.edges).toEqual([{ from: 'project:demo-api', to: 'project:sbom', type: 'depends_on' }]);
  });
});
