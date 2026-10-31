# loadweaver-frontend-util-configuration

Build-time environments for the Loadweaver frontends. Today that is the landing page (`loadweaver.com`): `environment.landingpage.ts` for development and `environment.landingpage.production.ts` for production, swapped in through `fileReplacements` in `apps/loadweaver/frontend-landingpage/project.json`. Runtime overrides come from the `/config` endpoint (`CONFIG` env var) via `loadRuntimeEnvironment`.

## Running unit tests

Run `nx test loadweaver-frontend-util-configuration` to execute the unit tests.
