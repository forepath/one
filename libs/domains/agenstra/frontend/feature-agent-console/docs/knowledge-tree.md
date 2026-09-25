# Knowledge tree clipboard and multi-select

The agent console knowledge tree supports multi-select, clipboard copy/cut/paste, and queued batch mutations (mirroring the file tree).

## Row highlights

Tree rows use soft background washes (no dots or side accents):

| State                         | Meaning                                          |
| ----------------------------- | ------------------------------------------------ |
| Open (info wash)              | Page currently shown in the editor               |
| Clipboard copy (success wash) | Node staged with Ctrl/Cmd+C (or context Copy)    |
| Clipboard cut (warning wash)  | Node staged with Ctrl/Cmd+X (or context Cut)     |
| Selected (primary wash)       | Current multi-select / focus for actions         |
| Busy (reduced opacity)        | Node id present in `mutatingIds` (in-flight API) |

Clipboard highlights apply to **topmost clipboard roots** only. They clear when the clipboard is cleared (after a successful cut paste, or when a new copy/cut replaces it).

## Selection

- **Plain click** selects one item (and opens a page / toggles a folder).
- **Ctrl/Cmd+click** toggles items in the selection without opening or expanding.
- **Shift+click** selects a contiguous range of currently visible rows (expanded folders only).
- **Click empty chrome** clears the selection so paste targets the workspace root.
- Destructive and clipboard actions operate on **topmost roots** only (a selected folder implies its descendants).

## Clipboard

| Shortcut   | Action                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| Ctrl/Cmd+C | Copy selection                                                                                                |
| Ctrl/Cmd+X | Cut selection (move on paste)                                                                                 |
| Ctrl/Cmd+V | Paste into the focus folder (or parent of a focused page); OS text-file paste uploads `.md` / `.mmd` / `.txt` |
| Delete     | Confirm delete for topmost selection roots                                                                    |
| F2         | Rename when exactly one topmost root is selected                                                              |

Context menu **Copy / Cut / Paste** uses the same clipboard service. The dedicated **Move** dialog remains single-item; multi-item moves use cut + paste. Clipboard paste uses `KnowledgeFacade.duplicateNode` via the clipboard service (same as file tree: no hover Duplicate button).

### Upload

- Header and per-folder upload buttons accept `.md`, `.mmd`, and `.txt` (multiple files).
- Header upload targets the single selected folder when exactly one folder is selected; otherwise workspace root.
- OS paste / drag-drop of allowed text files uses the same pipeline.
- Pending uploads show placeholder spinner rows until the API returns.
- Name collisions prompt **Replace** vs **Keep both** (`Title (1)`); colliding folders always keep both.

### Paste target and expand

Paste resolves the target as: selected/focused folder → parent of a focused page → workspace root (`null`).

If the target folder is collapsed, paste **expands it automatically** so the first pasted item is visible.

### Copy

- Each clipboard root is duplicated via the knowledge API, then moved under the paste target when the duplicate landed in a different parent.
- Duplicate titles use `Title (1)`, `Title (2)`, … (same as file-tree numbering).
- When a **page** title already exists at the paste target, a dialog offers **Replace** (overwrite content) or **Keep both**.
- Colliding **folders** always keep both with a numbered title.
- Copy leaves the clipboard intact so paste can be repeated.

### Cut / move

- Entries are moved with `updateNode({ parentId })`, queued sequentially (same pattern as multi-delete / multi-copy).
- Same-parent paste is a no-op for that entry.
- Name collisions on cut use numbered titles only (no replace).
- Moving a folder into itself or a descendant is rejected.
- After a successful cut paste, the clipboard clears.
- Node ids stay stable on move, so multi-selection does not need path remapping.

## Batch errors and busy markers

Clipboard operations run on a single-flight queue in `KnowledgeTreeClipboardService`. Failures surface on the tree error banner via `lastError` without aborting the whole app session.

In-flight mutations are tracked in NgRx `KnowledgeState.mutatingIds` and passed into the tree as `[mutatingIds]`. Busy rows show a spinner and reduced opacity.
