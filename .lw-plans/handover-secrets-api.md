# Handover: secrets administration — cluster API + frontend `SecretsService` (2026-10-29)

You are working in the Nx monorepo at `/home/marcelmenk/github/forepath/one`, product **Loadweaver** (NestJS control plane, Angular console). Your task is the server and data-access part of the new **secrets administration**. The console page, the fleet relay and the docs outside the secrets page are done by another agent; your files are exclusively yours for this task:

- `libs/domains/loadweaver/backend/feature-control-plane/src/lib/controllers/secrets.controller.ts`
- `libs/domains/loadweaver/backend/feature-control-plane/src/lib/services/secrets.service.ts`
- `libs/domains/loadweaver/frontend/data-access-console/src/lib/services/secrets.service.ts` (+ its spec, types, `src/index.ts` exports)
- their specs and any DTO / helper files you add next to them

Read first: `.lw-plans/loadweaver.md` section **3.40 Secrets administration** (decisions + the API contract table) and 3.22 (secrets & encryption); `docs/loadweaver/features/secrets-and-encryption.md` and `docs/loadweaver/features/projects-and-access.md` (current access rules). The names endpoint you or a colleague added earlier (`GET /api/projects/:project/secrets/names`, `SecretsService.listNames`) is the pattern to follow.

## What to build

Keep everything that exists today working exactly as before unless listed here. Backwards compatibility isn't needed (unreleased), but don't break the existing callers (`reference-source.ts` in the console uses `listNames`; Agenstra's `loadweaver-client.ts` writes secrets).

1. **`GET /api/projects/:project/secrets`** → `{ items: SecretSummary[] }`, sorted by name.
   `SecretSummary = { project: string; name: string; version: number; createdAt: string; updatedAt: string; updatedBy: string | null; reserved: boolean; usedBy: SecretUsage[] }`
   - `updatedBy`: the actor label of the last write as the audit log records it (a fleet person's on-behalf-of label when written through a fleet).
   - `reserved`: the name starts with `lw-` (platform-reserved).
   - **Never** a value, a ciphertext, a data key or a fingerprint that could be brute-forced on short values.
2. **`GET /api/secrets?project=&q=&limit=`** → `{ items: SecretSummary[] }` across every project the caller may list (cluster admins: all; project admins / operators: their projects). `project` narrows, `q` is a case-insensitive name substring, `limit` 1–500 (default 200). An empty result is `200 { items: [] }`, never a 403. Repeated `project` parameters are refused (400), like the other list routes.
3. **Access for listing (widened, user decision "writers may list")**: project **admin / operator** of that project or a **cluster admin**; personal access tokens additionally need `secrets:read`. Developers, viewers, infra operators without a project role and non-members get `403`, **before** checking the project exists (same as writes today). `lw-` names are only listed for cluster admins. Apply the same rule to the existing `GET …/secrets/names`.
4. **`PUT /api/projects/:project/secrets/:name`**: keep the body and the rules; respond with the new version's `SecretSummary` (no value).
5. **`DELETE /api/projects/:project/secrets/:name`**: refuse with **`409 { message, usedBy: SecretUsage[] }`** while any live resource references the secret; otherwise unchanged.
6. **`SecretUsage = { kind: string; project: string; name: string; pinnedVersion: number | null }`**: every live resource referencing `secret://<project>/<name>` — compose `secrets` / secret env references of Deployments, VirtualMachine cloud-init references, registry credentials, Git connection credentials, provider credentials if they are project secrets. `pinnedVersion` = the version the last applied plan pinned for that resource (null when not applied yet). Reuse the parsers that already exist (`libs/domains/loadweaver/shared/util-compose`, `util-model` resources, the plan pinning in `plans.service.ts`) rather than new string matching.
7. **Every secrets response** (`list`, `names`, `PUT`, `DELETE`, errors) sends `Cache-Control: no-store`.
8. **Fleet requests**: the fleet now relays these routes **only with the person's signed identity claim** (`relay-rules.ts`, `secret` rules). Make sure the secrets routes go through the same identity handling as the other person-scoped routes: roles capped to the person (`capRolesToFleetIdentity`, `access/project-access.service.ts`, `fleet-identity/fleet-identity.utils.ts`), and every write / delete audited with `onBehalfOf` like other fleet-delegated writes (`audit-log.service.ts`). A fleet request **without** a verified person must not reach secret data with the service credential's own rights. A 403 must explain the person's missing role (the fleet passes it through to the console).
9. **Frontend `SecretsService`** (`data-access-console`), exported from `src/index.ts` together with the types `SecretSummary`, `SecretUsage`, `SecretInUseError` (the 409 body):
   - `list(project: string): Observable<SecretSummary[]>`
   - `listAll(query?: { project?: string; q?: string; limit?: number }): Observable<SecretSummary[]>`
   - `setValue(project: string, name: string, value: string): Observable<SecretSummary>`
   - `delete(project: string, name: string): Observable<void>`
   - `listNames` unchanged.
     Use the same base-URL handling as the other console services (fleet mode routes through `{fleet}/clusters/<id>/api` without the service knowing). The value must not be logged, cached, retried into another request or kept in any field of the service.

## Security rules (existing patterns — keep them)

- Values are write-only: no route returns them, no error echoes them, no log line or audit entry contains them (actor, project, name, version only). Validation errors must not include the submitted value.
- Envelope encryption, version pinning, tmpfs delivery and the `lw-` reservation stay untouched.
- Denials come before existence checks (no project / secret enumeration through 404 vs 403).
- Names are validated as today; reject anything else with 400 (no path tricks).

## Tests

- Unit specs for the controller and service: access matrix (cluster admin, project admin, operator, developer, viewer, infra operator, non-member, PAT with / without `secrets:read` / `secrets:write`, fleet person capped by claim, `lw-` names), the 409 with `usedBy`, `pinnedVersion`, `no-store`, no value in responses / errors / audit (assert on serialized output), `listAll` filtering.
- Frontend `SecretsService` spec with `HttpTestingController` (URLs, the 409 error shape).
- Extend the existing case in `apps/loadweaver/backend-control-plane/src/integration/control-plane.integration.spec.ts` (around "stores secrets envelope-encrypted…") with list / 409 / no-store, but **do not run integration specs or labs** — those gates are on hold.

## Machine and repo rules

- Run heavy commands through the memory gate: `/tmp/uiq/tv/wait.sh bash -c "<command>"` (serialises with other agents, needs ≥ 5 GB free). Jest with `--maxWorkers=1`, `NX_DAEMON=false`; Jest 30 uses `--testPathPatterns`. Configs are `jest.config.cts`.
- Lint the touched projects (`npx nx run loadweaver-backend-feature-control-plane:lint`, `loadweaver-frontend-data-access-console:lint`) and Prettier the touched files.
- Don't commit. Don't touch `.npmrc`, Agenstra / Decabill code or data, or files outside the list above (if something outside is unavoidable, stop and describe it in the handback instead).

## Handback

Reply with: the final routes and response shapes (as implemented), the exported names from `data-access-console`, the exact 403 / 409 messages, anything that deviates from this contract and why, the test commands you ran with their results, and the list of touched files.
