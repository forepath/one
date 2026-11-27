import * as path from 'path';

import { formatFiles, generateFiles, OverwriteStrategy, Tree, updateJson } from '@nx/devkit';
import { applicationGenerator as generatorFn } from '@nx/node';

import { McpGeneratorSchema } from './schema';
import { resolveDomainAppPaths } from '../utils/domain-app-paths';

export async function mcpGenerator(tree: Tree, options: McpGeneratorSchema) {
  const { projectName, appRoot } = resolveDomainAppPaths(options.name, 'mcp', options, 'shared');

  await generatorFn(tree, {
    name: projectName,
    directory: appRoot,
    tags: 'type:app,scope:backend',
    skipPackageJson: true,
    unitTestRunner: 'jest',
    e2eTestRunner: 'jest',
  });

  updateJson(
    tree,
    'eslint.dep-constraints.json',
    (depConstraints: { sourceTag: string; onlyDependOnLibsWithTags: string[] }[]) => {
      const scopeTag = `scope:backend`;

      if (!depConstraints.some((constraint) => constraint.sourceTag === scopeTag)) {
        depConstraints.push({
          sourceTag: scopeTag,
          onlyDependOnLibsWithTags: [scopeTag, 'scope:shared'],
        });
      }

      return depConstraints;
    },
  );

  generateFiles(tree, path.join(__dirname, 'files'), appRoot, options, {
    overwriteStrategy: OverwriteStrategy.Overwrite,
  });

  const projectJsonPath = `${appRoot}/project.json`;

  updateJson(tree, projectJsonPath, (projectJson) => {
    if (projectJson.targets) {
      projectJson.targets.debug = {
        executor: 'nx:run-commands',
        options: {
          command: `npx @modelcontextprotocol/inspector node ./dist/${appRoot}/main.js`,
        },
        dependsOn: [{ target: 'build' }],
      };
    }

    return projectJson;
  });

  if (options.protected) {
    // TODO: Bootstrap authentication
  }

  await formatFiles(tree);
}

export default mcpGenerator;
