# marpdown-backend-data-manager

NestJS API for Marp presentation storage, encrypted assets, and PDF/PPTX export.

## Purpose

Persists user-owned presentations and asset trees, serves a file-tree HTTP API, and exports decks via Marp CLI with Chromium (Playwright) in the container image.

See the [feature library README](../../libs/domains/marpdown/backend/feature-data-manager/README.md) for API and entity details.

## Usage

### Prerequisites

- Node.js 24+
- PostgreSQL
- Identity auth (`users` or `keycloak`; API key is not supported for presentation routes)

### Commands

```bash
nx build marpdown-backend-data-manager
nx serve marpdown-backend-data-manager
nx test marpdown-backend-feature-data-manager
```

Default HTTP port: **3400** (`/api` prefix).

### Environment

| Variable | Description |
|----------|-------------|
| `DB_*` | PostgreSQL connection (default database `marpdown`) |
| `ENCRYPTION_KEY` | 32-byte key (base64) for AES-256-GCM on markdown and asset content |
| `AUTHENTICATION_METHOD` | `users`, `keycloak`, or `api-key` |
| `JWT_SECRET` | Required for `users` auth |
| `MARPDOWN_MAX_ASSET_BYTES` | Max upload size per asset (default 10MB) |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright browser cache in Docker (`/ms-playwright`) |
| `CHROME_PATH` / `BROWSER_PATH` | Set automatically in `Dockerfile.api` entrypoint for Marp export |

### Database

Migrations run on startup. Generate new migrations against `apps/marpdown/backend-data-manager/src/typeorm.config.ts`.

### Docker

Production image: `Dockerfile.api` (Debian + Playwright Chromium for Marp export).

```bash
nx run marpdown-backend-data-manager:api-container-image
```

Registry: `ghcr.io/forepath/marpdown-data-manager-api`

## CI and SBOM

| Target | Output |
|--------|--------|
| `sbom` | `dist/sboms/marpdown-backend-data-manager.cdx.json` |
| `api-container-image` | `ghcr.io/forepath/marpdown-data-manager-api` + Trivy `container-marpdown-data-manager-api.cdx.json` |

Pull-request CI runs `nx affected --target=sbom` and container builds when this project changes. Releases upload service and container SBOMs to Dependency Track and copy marpdown artifacts to R2 via `tools/ci/upload-release-sboms-by-domain.sh marpdown`.

See [docs/agenstra/security/ci-security-scanning.md](../../docs/agenstra/security/ci-security-scanning.md).

## License

GNU Affero General Public License v3 — see [LICENSE](./LICENSE).
