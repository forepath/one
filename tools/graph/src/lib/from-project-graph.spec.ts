import type { ProjectGraph } from '@nx/devkit';

import { fromProjectGraph } from './from-project-graph';

describe('fromProjectGraph', () => {
  it('should map projects and depends_on edges and skip npm externals', () => {
    const projectGraph = {
      nodes: {
        'app-a': {
          name: 'app-a',
          type: 'app',
          data: {
            root: 'apps/a',
            projectType: 'application',
            tags: ['domain:demo'],
            targets: { build: {}, test: {} },
          },
        },
        'lib-b': {
          name: 'lib-b',
          type: 'lib',
          data: {
            root: 'libs/b',
            projectType: 'library',
            tags: [],
            targets: { lint: {} },
          },
        },
      },
      dependencies: {
        'app-a': [
          { source: 'app-a', target: 'lib-b', type: 'static' },
          { source: 'app-a', target: 'npm:lodash', type: 'static' },
        ],
        'lib-b': [],
      },
      externalNodes: {
        'npm:lodash': {
          name: 'npm:lodash',
          type: 'npm',
          data: { packageName: 'lodash', version: '1.0.0' },
        },
      },
    } as unknown as ProjectGraph;

    const slice = fromProjectGraph(projectGraph);

    expect(slice.nodes).toHaveLength(2);
    expect(slice.nodes.map((n) => n.id).sort()).toEqual(['project:app-a', 'project:lib-b']);
    expect(slice.nodes.find((n) => n.id === 'project:app-a')?.type).toBe('app');
    expect(slice.nodes.find((n) => n.id === 'project:lib-b')?.type).toBe('lib');
    expect(slice.nodes.find((n) => n.id === 'project:app-a')?.attrs).toMatchObject({
      name: 'app-a',
      root: 'apps/a',
      type: 'app',
      targets: ['build', 'test'],
      tags: ['domain:demo'],
    });
    expect(slice.edges).toEqual([{ from: 'project:app-a', to: 'project:lib-b', type: 'depends_on' }]);
  });
});
