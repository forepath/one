import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import nativeGenerator from './native';

describe('nativeGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('scaffolds a native app under the selected domain', async () => {
    await nativeGenerator(tree, {
      name: 'agent-console',
      domain: 'agenstra',
      title: 'Agent Console',
    });

    expect(tree.exists('apps/agenstra/native-agent-console/project.json')).toBe(true);
    expect(tree.exists('apps/agenstra/native-agent-console/src/main.ts')).toBe(true);

    const projectJson = JSON.parse(tree.read('apps/agenstra/native-agent-console/project.json', 'utf-8')!);

    expect(projectJson.name).toBe('agenstra-native-agent-console');
    expect(projectJson.implicitDependencies).toEqual(['agenstra-frontend-agent-console']);
  });
});
