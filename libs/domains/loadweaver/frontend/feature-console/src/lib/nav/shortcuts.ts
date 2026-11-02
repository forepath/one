import type { ConsoleSectionId } from '../console-nav';

/** A recognised global shortcut (3.37). */
export type ConsoleShortcut =
  | { kind: 'prefix'; prefix: string }
  | { kind: 'search' }
  | { kind: 'tasks' }
  | { kind: 'tree' }
  | { kind: 'help' }
  | { kind: 'section'; section: ConsoleSectionId };

/** `g` + key → section. */
const GO_TO: Record<string, ConsoleSectionId> = {
  s: 'setup',
  r: 'resources',
  a: 'activity',
  o: 'observe',
  p: 'operate',
  d: 'delivery',
  c: 'access',
};

/** The shortcut for `key` after `prefix` (the previous key of a two-key sequence), or null. */
export function consoleShortcut(prefix: string | null, key: string): ConsoleShortcut | null {
  if (prefix === 'g') {
    const section = GO_TO[key.toLowerCase()];

    return section ? { kind: 'section', section } : null;
  }

  if (key === '/') return { kind: 'search' };
  if (key === '?') return { kind: 'help' };
  if (key === '`') return { kind: 'tasks' };
  if (key === '[') return { kind: 'tree' };
  if (key === 'g') return { kind: 'prefix', prefix: 'g' };

  return null;
}

/** Keys typed into fields, editors and content-editable areas are never shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;

  if (!element || typeof element.closest !== 'function') return false;

  return !!element.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], .monaco-editor, .xterm',
  );
}

/** One row of the shortcut help (`?`): the keys (each a `<kbd>`, `then` = a two-key sequence) and what they do. */
export interface ShortcutHelpEntry {
  keys: string[];
  /** `sequence`: press one after the other (`g` then `r`); `alternatives`: either key; default: together. */
  join?: 'sequence' | 'alternatives';
  label: string;
}

export interface ShortcutHelpGroup {
  id: string;
  title: string;
  entries: ShortcutHelpEntry[];
}

/** Every console shortcut (3.37), grouped for the `?` overlay; keep in sync with `consoleShortcut` / the pages. */
export const CONSOLE_SHORTCUT_GROUPS: ShortcutHelpGroup[] = [
  {
    id: 'global',
    title: $localize`:@@lwConsoleShortcuts-global:Everywhere`,
    entries: [
      {
        keys: ['Ctrl', 'K'],
        label: $localize`:@@lwConsoleShortcuts-palette:Open or close the search palette (⌘ K on macOS)`,
      },
      { keys: ['/'], label: $localize`:@@lwConsoleShortcuts-search:Search` },
      { keys: ['?'], label: $localize`:@@lwConsoleShortcuts-help:Show these shortcuts` },
      { keys: ['['], label: $localize`:@@lwConsoleShortcuts-tree:Show or hide the resource tree` },
      { keys: ['`'], label: $localize`:@@lwConsoleShortcuts-tasks:Open or close the task panel` },
      { keys: ['Esc'], label: $localize`:@@lwConsoleShortcuts-escape:Close the dialog, menu or palette` },
    ],
  },
  {
    id: 'go',
    title: $localize`:@@lwConsoleShortcuts-goTo:Go to`,
    entries: [
      { keys: ['g', 's'], join: 'sequence', label: $localize`:@@lwConsoleShortcuts-goSetup:Setup` },
      { keys: ['g', 'r'], join: 'sequence', label: $localize`:@@lwConsoleShortcuts-goResources:Resources` },
      { keys: ['g', 'a'], join: 'sequence', label: $localize`:@@lwConsoleShortcuts-goActivity:Activity` },
      { keys: ['g', 'o'], join: 'sequence', label: $localize`:@@lwConsoleShortcuts-goObserve:Observe` },
      { keys: ['g', 'p'], join: 'sequence', label: $localize`:@@lwConsoleShortcuts-goOperate:Operate` },
      { keys: ['g', 'd'], join: 'sequence', label: $localize`:@@lwConsoleShortcuts-goDelivery:Delivery` },
      { keys: ['g', 'c'], join: 'sequence', label: $localize`:@@lwConsoleShortcuts-goAccess:Access` },
    ],
  },
  {
    id: 'object',
    title: $localize`:@@lwConsoleShortcuts-object:On an object page`,
    entries: [
      { keys: ['e'], label: $localize`:@@lwConsoleShortcuts-edit:Edit (opens the edit dialog)` },
      { keys: ['Del'], label: $localize`:@@lwConsoleShortcuts-delete:Delete into the draft` },
    ],
  },
  {
    id: 'palette',
    title: $localize`:@@lwConsoleShortcuts-paletteGroup:In the search palette`,
    entries: [
      { keys: ['↑', '↓'], join: 'alternatives', label: $localize`:@@lwConsoleShortcuts-move:Move between results` },
      { keys: ['Enter'], label: $localize`:@@lwConsoleShortcuts-open:Open the result and reveal it in the tree` },
    ],
  },
];
