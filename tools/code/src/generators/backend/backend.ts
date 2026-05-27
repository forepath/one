import { formatFiles, Tree, updateJson } from '@nx/devkit';
import { applicationGenerator as generatorFn } from '@nx/nest';
import { setupDockerGenerator as setupDockerGeneratorFn } from '@nx/node/src/generators/setup-docker/setup-docker';

import { BackendGeneratorSchema } from './schema';

export async function backendGenerator(tree: Tree, options: BackendGeneratorSchema) {
  const appName = `backend-${options.name}`;
  const appRoot = `apps/${appName}`;

  await generatorFn(tree, {
    name: appName,
    directory: appRoot,
    tags: 'type:app,scope:backend',
    skipPackageJson: true,
    unitTestRunner: 'jest',
    e2eTestRunner: 'jest',
  });

  if (!tree.exists(`${appRoot}/package.json`)) {
    tree.write(
      `${appRoot}/package.json`,
      JSON.stringify(
        {
          name: appName,
          version: '0.0.0',
          private: true,
        },
        null,
        2,
      ),
    );
  }

  const oldWebpackConfigPath = `${appRoot}/webpack.config.js`;
  const newWebpackConfigPath = `${appRoot}/webpack.config.cjs`;

  if (tree.exists(oldWebpackConfigPath)) {
    const content = tree.read(oldWebpackConfigPath, 'utf-8');

    tree.write(newWebpackConfigPath, content);
    tree.delete(oldWebpackConfigPath);
  }

  updateJson(tree, `${appRoot}/project.json`, (json) => {
    if (json.targets?.build?.options?.webpackConfig) {
      json.targets.build.options.webpackConfig = json.targets.build.options.webpackConfig.replace(
        'webpack.config.js',
        'webpack.config.cjs',
      );
    }

    return json;
  });

  await setupDockerGeneratorFn(tree, {
    project: appName,
    outputPath: `dist/${appRoot}`,
    buildTarget: 'build',
  });

  const dockerfilePath = `${appRoot}/Dockerfile`;

  if (tree.exists(dockerfilePath)) {
    const dockerfileContent = tree.read(dockerfilePath, 'utf-8');
    const updatedContent = dockerfileContent.replace('COPY dist .', 'COPY . /app');

    tree.write(dockerfilePath, updatedContent);
  }

  updateJson(tree, `${appRoot}/project.json`, (json) => {
    if (json.targets?.['docker:build']) {
      delete json.targets['docker:build'];
    }

    if (!json.targets?.['docker']) {
      json.targets['docker'] = {
        dependsOn: ['build', 'prune'],
        executor: 'nx:run-commands',
        options: {
          cwd: `dist/${appRoot}`,
          command: `docker build . -f ../../../${appRoot}/Dockerfile --tag apps-${appName}`,
        },
      };
    }

    return json;
  });

  updateJson(tree, '.eslintrc.json', (json) => {
    const depConstraints = json.overrides[1].rules['@nx/enforce-module-boundaries'][1].depConstraints || [];
    const scopeTag = `scope:backend`;

    if (!depConstraints.some((constraint) => constraint.sourceTag === scopeTag)) {
      depConstraints.push({
        sourceTag: scopeTag,
        onlyDependOnLibsWithTags: [scopeTag, 'scope:shared'],
      });
    }

    json.overrides[1].rules['@nx/enforce-module-boundaries'][1].depConstraints = depConstraints;

    return json;
  });

  if (options.protected) {
    // TODO: Bootstrap authentication
  }

  await formatFiles(tree);
}

export default backendGenerator;
