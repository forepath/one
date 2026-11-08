import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { auditPatRouteScopes, collectControllerClasses } from '@forepath/identity/backend';

import { AdminOpencodeConfigController } from '../controllers/admin-opencode-config.controller';
import { AdminOpencodeLayerFilesController } from '../controllers/admin-opencode-layer-files.controller';
import { ContextImportController } from '../controllers/context-import.controller';
import { DeploymentConnectionsController } from '../controllers/deployment-connections.controller';

import { AGENSTRA_PAT_SCOPES } from './agenstra-pat.scopes';

const controllersDir = join(__dirname, '..', 'controllers');

describe('Agenstra PAT route scopes', () => {
  const modules = readdirSync(controllersDir)
    .filter((file) => file.endsWith('.controller.ts'))
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    .map((file) => require(join(controllersDir, file)) as Record<string, unknown>);
  const controllers = collectControllerClasses(modules);

  it('loads the controllers', () => {
    expect(controllers.length).toBeGreaterThan(20);
  });

  it('declares cataloged, level-consistent scopes on every PAT-reachable route', () => {
    expect(
      auditPatRouteScopes(controllers, {
        catalog: AGENSTRA_PAT_SCOPES,
        // Admin enforced in code via assertAdmin (no @UsersRoles on these controllers).
        inCodeAdminControllers: [
          AdminOpencodeConfigController,
          AdminOpencodeLayerFilesController,
          ContextImportController,
          DeploymentConnectionsController,
        ],
      }),
    ).toEqual([]);
  });
});
