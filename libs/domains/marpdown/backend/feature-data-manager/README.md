# Marpdown Data Manager (backend feature)

NestJS module for presentation CRUD, encrypted asset storage, and Marp CLI export.

## API

OpenAPI spec: [`spec/openapi.yaml`](spec/openapi.yaml)

Base path: `/api/presentations`

| Area | Endpoints |
|------|-----------|
| Presentations | List (paginated), create, get, patch, delete, import markdown |
| Assets | File-tree API under `/presentations/:id/assets` (list, read, write, create, move, delete) |
| Export | `POST /presentations/:id/export` → PDF or PPTX stream |

## Data model

- **PresentationEntity** — `user_id`, `title`, encrypted `markdown`
- **PresentationAssetEntity** — path, encrypted base64 content, mime, `is_directory`

Markdown and asset bodies use `createAes256GcmTransformer()` on text columns.

## Access control

`ensurePresentationOwner` enforces strict user ownership. No admin bypass; API key auth is rejected for presentation operations.

## Export pipeline

1. Load decrypted markdown and assets
2. Materialize temp workspace (`presentation.md` + relative asset paths)
3. Run `marpCli` with `--allow-local-files` and `--browser-path` (Playwright Chromium)
4. Stream result; cleanup temp dir in `finally`

Backend Docker image must include Chromium (see `apps/marpdown/backend-data-manager/Dockerfile.api`).

## Tests

```bash
nx test marpdown-backend-feature-data-manager
```

## License

GNU Affero General Public License v3 — see [LICENSE](./LICENSE).
