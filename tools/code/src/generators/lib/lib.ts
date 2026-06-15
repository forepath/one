import { libraryGenerator as angularLibraryGenerator, UnitTestRunner } from '@nx/angular/generators';
import { formatFiles, GeneratorCallback, Tree, updateJson } from '@nx/devkit';
import { libraryGenerator as jsLibraryGenerator } from '@nx/js';
import { libraryGenerator as nodeLibraryGenerator } from '@nx/node';

import { LibGeneratorSchema } from './schema';

export async function libGenerator(tree: Tree, options: LibGeneratorSchema) {
  const domainRoot = `libs/domains/${options.domain}`;
  const libName = `${options.domain}-${options.scope}-${options.type}-${options.name}`;
  const libImportRoot = `${options.type}-${options.name}`;
  const libFolder = `${options.scope}/${libImportRoot}`;
  const libRoot = `${domainRoot}/${libFolder}`;
  let generatorFn: (tree: Tree, schema: any) => Promise<GeneratorCallback>;

  switch (options.generator) {
    case 'js':
      generatorFn = jsLibraryGenerator;
      break;
    case 'node':
      generatorFn = nodeLibraryGenerator;
      break;
    case 'angular':
      generatorFn = angularLibraryGenerator;
      break;
    default:
      throw new Error(`Unsupported generator type: ${options.generator}`);
  }

  const importPath = `@forepath/${options.domain}/${options.scope}/${libImportRoot}`;

  await generatorFn(tree, {
    name: libName,
    directory: libRoot,
    tags: `domain:${options.domain},scope:${options.scope},type:${options.type}`,
    importPath,
    prefix: options.domain,
    skipTsConfig: true,
    style: 'scss',
    unitTestRunner: UnitTestRunner.Jest,
  });

  const domainIndex = `libs/domains/${options.domain}/${options.scope}/index.ts`;

  if (!tree.exists(domainIndex)) {
    tree.write(domainIndex, `// ${options.domain} domain ${options.scope} exports\n`);
  }

  const exportPath = `./${libImportRoot}/src`;
  const exportLine = `export * from '${exportPath}';\n`;
  const current = tree.read(domainIndex, 'utf-8') || '';

  if (!current.includes(exportLine)) {
    tree.write(domainIndex, current + exportLine);
  }

  updateJson(tree, 'tsconfig.base.json', (json) => {
    json.compilerOptions.paths = json.compilerOptions.paths || {};
    json.compilerOptions.paths[importPath] = [`${libRoot}/src/index.ts`];

    return json;
  });

  updateJson(tree, '.eslintrc.json', (json) => {
    const depConstraints = json.overrides[1].rules['@nx/enforce-module-boundaries'][1].depConstraints || [];
    const scopeTag = `scope:${options.scope}`;

    if (!depConstraints.some((constraint) => constraint.sourceTag === scopeTag)) {
      depConstraints.push({
        sourceTag: scopeTag,
        onlyDependOnLibsWithTags: [scopeTag, 'scope:shared'],
      });
    }

    json.overrides[1].rules['@nx/enforce-module-boundaries'][1].depConstraints = depConstraints;

    return json;
  });

  await formatFiles(tree);
}

export default libGenerator;
