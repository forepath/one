import * as path from 'path';

import { E2eTestRunner, applicationGenerator as generatorFn, UnitTestRunner } from '@nx/angular/generators';
import { formatFiles, generateFiles, OverwriteStrategy, Tree, updateJson } from '@nx/devkit';

import { KeycloakThemeGeneratorSchema } from './schema';

export async function keycloakThemeGenerator(tree: Tree, options: KeycloakThemeGeneratorSchema) {
  const appName = `keycloak-theme-${options.name}`;
  const appRoot = `apps/${appName}`;
  const appPrefix = options.prefix || options.name;

  await generatorFn(tree, {
    name: appName,
    directory: appRoot,
    tags: 'type:app,scope:keycloak',
    routing: false,
    standalone: true,
    prefix: appPrefix,
    style: 'scss',
    ssr: false,
    unitTestRunner: UnitTestRunner.Jest,
    e2eTestRunner: E2eTestRunner.None,
    skipPackageJson: true,
  });

  const publicPath = path.join(appRoot, 'public');

  if (tree.exists(publicPath)) {
    tree.delete(publicPath);
  }

  const srcPath = path.join(appRoot, 'src');

  if (tree.exists(srcPath)) {
    tree.delete(srcPath);
  }

  generateFiles(tree, path.join(__dirname, 'files'), appRoot, options, {
    overwriteStrategy: OverwriteStrategy.Overwrite,
  });

  updateJson(tree, path.join(appRoot, 'project.json'), (json) => ({
    ...json,
    targets: {
      prebuild: {
        executor: '@nx/vite:build',
        outputs: ['{options.outputPath}'],
        options: {
          configFile: `${appRoot}/vite.config.ts`,
          outputPath: `${appRoot}/dist`,
        },
      },
      build: {
        executor: 'nx:run-commands',
        options: {
          command: `rm -rf dist/${appName}/bundle && mkdir -p dist/${appName}/bundle && mv ${appRoot}/dist/* dist/${appName}/bundle/ && rm -rf ${appRoot}/dist`,
        },
        dependsOn: [
          {
            target: 'prebuild',
          },
        ],
      },
      serve: {
        executor: '@nx/vite:dev-server',
        options: {
          buildTarget: `${appName}:build`,
        },
      },
      prepublish: {
        executor: 'nx:run-commands',
        options: {
          command: `nx run ${appName}:prebuild && npx keycloakify build --project ${appRoot}`,
        },
      },
      publish: {
        executor: 'nx:run-commands',
        options: {
          command: `rm -rf dist/${appName}/bin && mkdir -p dist/${appName}/bin && mv ${appRoot}/dist_keycloak/* dist/${appName}/bin/ && rm -rf ${appRoot}/dist ${appRoot}/dist_keycloak`,
        },
        dependsOn: [
          {
            target: 'prepublish',
          },
        ],
      },
      'serve-storybook': {
        executor: '@storybook/angular:start-storybook',
        options: {
          configDir: `${appRoot}/.storybook`,
          compodoc: false,
          browserTarget: `${appName}:build-storybook`,
        },
      },
      'build-storybook': {
        executor: '@storybook/angular:build-storybook',
        options: {
          configDir: `${appRoot}/.storybook`,
          compodoc: false,
          outputDir: `dist/${appRoot}-storybook`,
        },
      },
    },
  }));

  await formatFiles(tree);
}

export default keycloakThemeGenerator;
