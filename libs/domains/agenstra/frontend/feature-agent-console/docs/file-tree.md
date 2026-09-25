# File tree clipboard and multi-select

The agent console file tree supports multi-select, clipboard copy/cut/paste, and queued batch mutations.

## Row highlights

Tree rows use soft background washes (no dots or side accents):

| State                         | Meaning                                       |
| ----------------------------- | --------------------------------------------- |
| Open (info wash)              | File currently shown in the editor            |
| Clipboard copy (success wash) | Path staged with Ctrl/Cmd+C (or context Copy) |
| Clipboard cut (warning wash)  | Path staged with Ctrl/Cmd+X (or context Cut)  |
| Selected (primary wash)       | Current multi-select / focus for actions      |

Clipboard highlights apply to **topmost clipboard roots** only. They clear when the clipboard is cleared (after a successful cut paste, or when a new copy/cut replaces it).

## Selection

- **Plain click** selects one item (and opens a file / toggles a folder).
- **Ctrl/Cmd+click** toggles items in the selection without opening or expanding.
- **Shift+click** selects a contiguous range of currently visible rows (expanded folders only).
- **Click empty chrome** clears the selection so paste targets the workspace root.
- Destructive and clipboard actions operate on **topmost roots** only (a selected folder implies its descendants).

## Clipboard

| Shortcut   | Action                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| Ctrl/Cmd+C | Copy selection                                                                               |
| Ctrl/Cmd+X | Cut selection (move on paste)                                                                |
| Ctrl/Cmd+V | Paste into the focus folder (or parent of a focused file); OS clipboard files upload instead |

Context menu **Copy / Cut / Paste** uses the same clipboard service. The dedicated **Move** dialog remains single-item; multi-item moves use cut + paste.

### Paste target and expand

Paste resolves the target as: selected/focused directory → parent of a focused file → workspace root (`.`).

If the target folder is collapsed, paste **expands it automatically** (same behaviour as uploading into that folder) so the first pasted item is visible.

### Copy

- Files are read then re-created at the destination.
- When a **file** name already exists, a dialog offers **Replace** (overwrite content) or **Keep both** (`name (1).ext`).
- Colliding **directories** always keep both with a numbered name (cannot replace a folder with a file).
- Directories are copied **recursively** (create folder, then each nested file/folder).
- Copy leaves the clipboard intact so paste can be repeated.

### Cut / move

- Entries are moved with the existing move API, queued sequentially (same pattern as multi-delete / multi-copy).
- Name collisions at the destination get a `(1)` / `(2)` suffix only (no replace); same-path paste is a no-op.
- Moving a directory into itself or a descendant is rejected.
- After a successful cut paste, the clipboard clears.
- Open editor **tabs / ribbon paths**, dirty flags, expanded folders, and the active file remapped when a moved path (or a file under a moved folder) changes.

### Upload target

- Folder-row / context upload buttons always target that folder.
- Header upload targets the **single selected directory** when exactly one path is selected and it is a directory; otherwise workspace root (`.`).
- Upload name collisions use the same Replace / Keep both dialog as copy paste.

## Batch errors

Clipboard operations run on a single-flight queue. Failures surface on the tree error banner via `FileTreeClipboardService.lastError` without aborting the whole app session.
