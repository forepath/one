# marpdown-frontend-editor

Angular SSR app for editing Marp presentations with Milkdown, live preview, and asset management.

## Purpose

Three-pane editor: asset tree, Milkdown markdown editor (undo/redo), and live Marp preview. Authenticated users manage presentations and export PDF/PPTX via the data-manager API.

## Usage

### Commands

```bash
nx serve marpdown-frontend-editor          # http://localhost:4600
nx build marpdown-frontend-editor
nx test marpdown-frontend-data-access-editor
```

### Configuration

- Build-time: `environment.marpdown.ts` / `environment.marpdown.production.ts` (file replacements in `project.json`)
- Runtime override: `examples/config.json` (`marpdown.restApiUrl`)

Primary theme color: `#4287f5`.

### Auth

Uses shared identity auth (`users` or `keycloak`). After login, users land on `/presentations`. Admin user management is available via identity routes when enabled.

### i18n

Locales: `en`, `de` — catalogs under `src/i18n/`.

### Docker

Production SSR image: `Dockerfile.server` (port **4600**).

```bash
nx run marpdown-frontend-editor:server-container-image
```

Registry: `ghcr.io/forepath/marpdown-editor-server`

## CI and SBOM

| Target | Output |
|--------|--------|
| `sbom` | `dist/sboms/marpdown-frontend-editor.cdx.json` |
| `server-container-image` | `ghcr.io/forepath/marpdown-editor-server` + Trivy `container-marpdown-editor-server.cdx.json` |

Pull-request CI runs affected `sbom` and `server-container-image` targets. Releases upload SBOMs to Dependency Track and R2 (marpdown domain).

See [docs/agenstra/security/ci-security-scanning.md](../../docs/agenstra/security/ci-security-scanning.md).

## License

GNU Affero General Public License v3 — see [LICENSE](./LICENSE).
