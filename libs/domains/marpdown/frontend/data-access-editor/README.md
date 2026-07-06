# marpdown-frontend-data-access-editor

NgRx data layer and HTTP services for the Marpdown editor.

## Slices

| Slice | Responsibility |
|-------|----------------|
| `presentations` | Batch-loaded list, CRUD, pagination |
| `editor` | Active presentation markdown, save/import state |
| `assets` | File-tree load and mutations |

## Services

- `PresentationsService` — REST against `/api/presentations`
- `PresentationAssetsService` — asset file API
- `PresentationExportService` — export download

Types align with [`spec/openapi.yaml`](../../backend/feature-data-manager/spec/openapi.yaml) in the backend feature library.

## Tests

```bash
nx test marpdown-frontend-data-access-editor
```

## License

GNU Affero General Public License v3 — see [LICENSE](./LICENSE).
