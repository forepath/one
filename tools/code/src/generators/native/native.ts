import * as path from 'path';

import { formatFiles, generateFiles, Tree } from '@nx/devkit';

import { resolveDomainAppPaths } from '../utils/domain-app-paths';
import { NativeGeneratorSchema } from './schema';

export async function nativeGenerator(tree: Tree, options: NativeGeneratorSchema) {
  const { domain, roleName, projectName, appRoot } = resolveDomainAppPaths(options.name, 'native', options, 'agenstra');
  const frontendRoleName = `frontend-${options.name}`;
  const frontendProjectName = options.frontendProject ?? `${domain}-${frontendRoleName}`;
  const frontendAppRoot = `apps/${domain}/${frontendRoleName}`;
  const displayTitle = options.title ?? roleName;

  generateFiles(tree, path.join(__dirname, 'files'), appRoot, {
    ...options,
    domain,
    roleName,
    projectName,
    appRoot,
    frontendProjectName,
    frontendAppRoot,
    displayTitle,
    debPackageName: domain,
  });

  await formatFiles(tree);
}

export default nativeGenerator;
