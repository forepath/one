import * as path from 'path';

import { formatFiles, generateFiles, Tree, updateJson } from '@nx/devkit';

import { DomainGeneratorSchema } from './schema';

export async function domainGenerator(tree: Tree, options: DomainGeneratorSchema) {
  const domainRoot = `libs/domains/${options.name}`;

  generateFiles(tree, path.join(__dirname, 'files'), domainRoot, options);

  updateJson(tree, 'tsconfig.base.json', (json) => {
    const prefix =
      options.prefix && options.prefix.length > 0
        ? options.prefix.endsWith('/')
          ? options.prefix
          : options.prefix + '/'
        : '@domain/';

    json.compilerOptions.paths = json.compilerOptions.paths || {};
    json.compilerOptions.paths[`${prefix}${options.name}/backend`] = [`${domainRoot}/backend/index.ts`];
    json.compilerOptions.paths[`${prefix}${options.name}/frontend`] = [`${domainRoot}/frontend/index.ts`];
    json.compilerOptions.paths[`${prefix}${options.name}/keycloak`] = [`${domainRoot}/keycloak/index.ts`];
    json.compilerOptions.paths[`${prefix}${options.name}/shared`] = [`${domainRoot}/shared/index.ts`];

    return json;
  });

  updateJson(
    tree,
    'eslint.dep-constraints.json',
    (depConstraints: { sourceTag: string; onlyDependOnLibsWithTags: string[] }[]) => {
      const domainTag = `domain:${options.name}`;

      if (!depConstraints.some((constraint) => constraint.sourceTag === domainTag)) {
        depConstraints.push({
          sourceTag: domainTag,
          onlyDependOnLibsWithTags: [domainTag, 'domain:shared'],
        });
      }

      return depConstraints;
    },
  );

  await formatFiles(tree);
}

export default domainGenerator;
