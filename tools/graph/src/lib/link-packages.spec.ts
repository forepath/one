import { linkPackages } from './link-packages';
import { packageNodeId, projectNodeId } from './schema';
import type { ProjectGraph } from '@nx/devkit';

describe('linkPackages', () => {
  const projectGraph = {
    nodes: {
      'demo-api': {
        name: 'demo-api',
        type: 'app',
        data: { root: 'apps/demo-api', projectType: 'application', tags: [], targets: {} },
      },
      'demo-lib': {
        name: 'demo-lib',
        type: 'lib',
        data: { root: 'libs/demo-lib', projectType: 'library', tags: [], targets: {} },
      },
    },
    dependencies: {},
  } as unknown as ProjectGraph;

  it('should attribute production packages to applications only', () => {
    const result = linkPackages({
      projectGraph,
      workspaceRoot: '/tmp',
      resolveProductionDeps: (projectName) => {
        if (projectName === 'demo-api') {
          return { '@nestjs/common': '11.1.6', lodash: '4.17.21' };
        }
        return { 'should-not-appear': '1.0.0' };
      },
    });

    expect(result.nodes.map((n) => n.id).sort()).toEqual([packageNodeId('@nestjs/common'), packageNodeId('lodash')]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { from: projectNodeId('demo-api'), to: packageNodeId('@nestjs/common'), type: 'depends_on' },
        { from: projectNodeId('demo-api'), to: packageNodeId('lodash'), type: 'depends_on' },
      ]),
    );
    expect(result.edges.some((e) => e.from === projectNodeId('demo-lib'))).toBe(false);
  });
});
