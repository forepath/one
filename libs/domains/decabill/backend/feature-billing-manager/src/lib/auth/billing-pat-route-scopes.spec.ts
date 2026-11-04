// archiver ships ESM only; controllers are loaded for metadata, never executed.
jest.mock('archiver', () => ({ ZipArchive: jest.fn() }));

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { auditPatRouteScopes, collectControllerClasses } from '@forepath/identity/backend';

import { BILLING_PAT_SCOPES } from './billing-pat.scopes';

const libDir = join(__dirname, '..');

function findControllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return findControllerFiles(path);
    }

    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

describe('Decabill PAT route scopes', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const modules = findControllerFiles(libDir).map((file) => require(file) as Record<string, unknown>);
  const controllers = collectControllerClasses(modules);

  it('loads the controllers', () => {
    expect(controllers.length).toBeGreaterThan(30);
  });

  it('declares cataloged, level-consistent scopes on every PAT-reachable route', () => {
    expect(
      auditPatRouteScopes(controllers, {
        catalog: BILLING_PAT_SCOPES,
        // Admin enforced in services via ensureProjectAdmin (controllers also serve customers).
        inCodeAdminRoutes: [
          'ProjectMilestonesController.create',
          'ProjectMilestonesController.update',
          'ProjectMilestonesController.lock',
          'ProjectMilestonesController.delete',
          'ProjectTimeEntriesController.create',
          'ProjectTimeEntriesController.update',
          'ProjectTimeEntriesController.delete',
          'ProjectTicketsController.create',
          'ProjectTicketsController.update',
          'ProjectTicketsController.delete',
          'ProjectTicketAttachmentsController.upload',
          'ProjectTicketAttachmentsController.delete',
        ],
      }),
    ).toEqual([]);
  });
});
