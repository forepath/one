# marpdown-frontend-feature-editor

Routable UI for the Marpdown editor: presentations list and three-pane editor.

## Layout

| Column | Component | Role |
|--------|-----------|------|
| Left | Asset tree | Browse/create/move/delete presentation assets |
| Center | Milkdown editor | Markdown editing with undo/redo toolbar |
| Right | Marp preview | Live slide preview via `@marp-team/marp-core` |

Toolbar: save, import markdown, export PDF/PPTX.

## Routes

Exported as `marpdownRoutes` from this library and lazy-loaded by `marpdown-frontend-editor`.

## Preview assets

Preview resolves local asset URLs against the authenticated assets API so images in markdown render in the Marp preview pane.

## Tests

Component tests are optional; behavior is covered by data-access NgRx tests.

## License

GNU Affero General Public License v3 — see [LICENSE](./LICENSE).
