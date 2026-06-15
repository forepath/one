import * as path from 'path';

import { E2eTestRunner, applicationGenerator as generatorFn, UnitTestRunner } from '@nx/angular/generators';
import { formatFiles, generateFiles, OverwriteStrategy, Tree, updateJson } from '@nx/devkit';
import { setupDockerGenerator as setupDockerGeneratorFn } from '@nx/node/src/generators/setup-docker/setup-docker';

import { FrontendGeneratorSchema } from './schema';

export async function frontendGenerator(tree: Tree, options: FrontendGeneratorSchema) {
  const domain = options.domain ?? 'agenstra';
  const roleName = `frontend-${options.name}`;
  const projectName = `${domain}-${roleName}`;
  const appRoot = `apps/${domain}/${roleName}`;
  const appPrefix = options.prefix || options.name;

  await generatorFn(tree, {
    name: projectName,
    directory: appRoot,
    tags: 'type:app,scope:frontend',
    routing: true,
    standalone: true,
    prefix: appPrefix,
    style: 'scss',
    ssr: options.ssr || false,
    skipPackageJson: true,
    unitTestRunner: UnitTestRunner.Jest,
    e2eTestRunner: E2eTestRunner.Playwright,
  });

  updateJson(tree, '.eslintrc.json', (json) => {
    const depConstraints = json.overrides[1].rules['@nx/enforce-module-boundaries'][1].depConstraints || [];
    const scopeTag = `scope:frontend`;

    if (!depConstraints.some((constraint) => constraint.sourceTag === scopeTag)) {
      depConstraints.push({
        sourceTag: scopeTag,
        onlyDependOnLibsWithTags: [scopeTag, 'scope:shared'],
      });
    }

    json.overrides[1].rules['@nx/enforce-module-boundaries'][1].depConstraints = depConstraints;

    return json;
  });

  const appSrcPath = `${appRoot}/src`;

  if (options.ssr) {
    generateFiles(tree, path.join(__dirname, 'files', 'ssr'), appSrcPath, options, {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    });

    await setupDockerGeneratorFn(tree, {
      project: projectName,
      outputPath: `dist/${appRoot}/server`,
      buildTarget: 'build',
    });

    const dockerfilePath = `${appRoot}/Dockerfile`;

    if (tree.exists(dockerfilePath)) {
      const dockerfileContent = tree.read(dockerfilePath, 'utf-8');
      const updatedContent = dockerfileContent
        .replace('COPY dist .', 'COPY . /app')
        .replace('ENV PORT=3000', 'ENV PORT=4000')
        .replace('CMD [ "node", "main.js" ]', 'CMD [ "node", "server.mjs" ]');

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
            cwd: `dist/${appRoot}/server`,
            command: `docker build . -f ../../../../${appRoot}/Dockerfile --tag apps-${projectName}`,
          },
        };
      }

      return json;
    });

    if (tree.exists(dockerfilePath)) {
      let dockerfileContent = tree.read(dockerfilePath, 'utf-8');

      dockerfileContent = dockerfileContent
        .split('\n')
        .filter(
          (line) =>
            !line.trim().startsWith('# You can remove this install step if you build with `--bundle` option.') &&
            !line.trim().startsWith('# The bundled output will include external dependencies.') &&
            !line.trim().startsWith('RUN npm --omit=dev -f install'),
        )
        .join('\n');

      tree.write(dockerfilePath, dockerfileContent);
    }

    if (options.localization) {
      generateFiles(tree, path.join(__dirname, 'files', 'ssr'), appSrcPath, options, {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      });

      updateJson(tree, `${appRoot}/project.json`, (json) => {
        if (!json.targets?.['build-delegating-server']) {
          json.targets['build-delegating-server'] = {
            executor: 'nx:run-commands',
            outputs: [`{workspaceRoot}/dist/${appRoot}-delegating-server`],
            options: {
              command: `mkdir -p dist/${appRoot}-delegating-server/server && npx tsc ${appRoot}/src/delegating-server.ts --outDir dist/${appRoot}-delegating-server/server --target es2022 --module esnext --moduleResolution node --allowSyntheticDefaultImports --esModuleInterop --skipLibCheck --declaration false --sourceMap false --removeComments true`,
              cwd: '.',
            },
          };
        }

        if (!json.targets?.['postbuild']) {
          json.targets['postbuild'] = {
            executor: 'nx:run-commands',
            options: {
              command: `cp dist/${appRoot}-delegating-server/server/delegating-server.js dist/${appRoot}/server/server.mjs && cp -r dist/${appRoot}/browser dist/${appRoot}/server/browser`,
            },
            dependsOn: ['build', 'build-delegating-server'],
          };
        }

        if (json.targets?.docker?.dependsOn) {
          json.targets.docker.dependsOn = ['build', 'build-delegating-server', 'postbuild', 'prune'];
        }

        return json;
      });

      const tsconfigAppPath = `${appRoot}/tsconfig.app.json`;

      if (tree.exists(tsconfigAppPath)) {
        updateJson(tree, tsconfigAppPath, (tsconfig) => {
          if (!tsconfig.include) {
            tsconfig.include = [];
          }

          if (!tsconfig.include.includes('src/delegating-server.ts')) {
            tsconfig.include.push('src/delegating-server.ts');
          }

          return tsconfig;
        });
      }
    }
  }

  if (options.ui) {
    if (options.ui !== 'none') {
      generateFiles(tree, path.join(__dirname, 'files', options.ui), appSrcPath, options, {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      });

      const nxWelcomeComponentPath = `${appSrcPath}/app/nx-welcome.component.ts`;

      if (tree.exists(nxWelcomeComponentPath)) {
        tree.delete(nxWelcomeComponentPath);
      }
    }

    if (options.ui === 'bootstrap') {
      const projectJsonPath = `${appRoot}/project.json`;

      updateJson(tree, projectJsonPath, (projectJson) => {
        if (!projectJson.targets?.build?.options?.scripts) {
          projectJson.targets.build.options.scripts = [];
        }

        projectJson.targets.build.options.scripts = [
          ...projectJson.targets.build.options.scripts,
          'node_modules/@popperjs/core/dist/umd/popper.min.js',
          'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js',
        ];

        return projectJson;
      });
    }
  }

  if (options.localization) {
    const polyfillsTsPath = `${appRoot}/src/polyfills.ts`;
    let polyfillsContent = '';

    if (tree.exists(polyfillsTsPath)) {
      polyfillsContent = tree.read(polyfillsTsPath, 'utf-8') || '';
    } else {
      tree.write(polyfillsTsPath, '');
    }

    if (!polyfillsContent.includes('import "@angular/localize/init";')) {
      const updatedContent = `import "@angular/localize/init";\n${polyfillsContent}`;

      tree.write(polyfillsTsPath, updatedContent);
    }

    const projectJsonPath = `${appRoot}/project.json`;
    const projectTranslationsPath = `${appRoot}/src/i18n`;

    updateJson(tree, projectJsonPath, (projectJson) => {
      if (!projectJson.i18n) {
        projectJson.i18n = {
          sourceLocale: 'en-US',
          locales: {
            en: `${appRoot}/src/i18n/messages.en.xlf`,
            de: `${appRoot}/src/i18n/messages.de.xlf`,
          },
        };
      }

      if (projectJson.targets?.build?.options) {
        projectJson.targets.build.options.localize = true;
        projectJson.targets.build.options.i18nMissingTranslation = 'warning';

        let polyfills = projectJson.targets.build.options.polyfills;

        if (!Array.isArray(polyfills)) {
          polyfills = polyfills ? [polyfills] : [];
        }

        const relPolyfillsPath = `${appRoot}/src/polyfills.ts`;

        if (!polyfills.includes(relPolyfillsPath)) {
          polyfills.push(relPolyfillsPath);
          projectJson.targets.build.options.polyfills = polyfills;
        }
      }

      if (projectJson.targets?.build?.configurations) {
        projectJson.targets.build.configurations = {
          ...projectJson.targets.build.configurations,
          en: {
            localize: ['en'],
          },
          de: {
            localize: ['de'],
          },
        };
      }

      if (projectJson.targets?.serve?.configurations) {
        const serveConfigurations = Object.keys(projectJson.targets.serve.configurations);

        serveConfigurations.forEach((configuration: string) => {
          projectJson.targets.serve.configurations[configuration].buildTarget =
            projectJson.targets.serve.configurations[configuration].buildTarget + ',en';
        });
      }

      if (projectJson.targets!['extract-i18n']?.options) {
        projectJson.targets['extract-i18n'].options.outputPath = projectTranslationsPath;
      }

      return projectJson;
    });

    if (!tree.exists(projectTranslationsPath)) {
      const appI18nPath = `${appSrcPath}/i18n`;

      generateFiles(tree, path.join(__dirname, 'files', 'i18n'), appI18nPath, options);
    }

    const tsConfigPath = `${appRoot}/tsconfig.app.json`;

    if (tree.exists(tsConfigPath)) {
      updateJson(tree, tsConfigPath, (tsConfig) => {
        if (!tsConfig.files) {
          tsConfig.files = [];
        }

        const relPolyfillsPath = `src/polyfills.ts`;

        if (!tsConfig.files.includes(relPolyfillsPath)) {
          tsConfig.files.push(relPolyfillsPath);
        }

        return tsConfig;
      });
    }
  }

  if (options.protected) {
    // TODO: Bootstrap authentication
  }

  await formatFiles(tree);
}

export default frontendGenerator;
