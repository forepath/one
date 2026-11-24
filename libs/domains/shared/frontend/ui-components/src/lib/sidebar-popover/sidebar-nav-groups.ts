/** Minimal shape of a sidebar link the grouping helpers work with (the apps add router link, badge key, etc.). */
export interface FpcSidebarNavLink {
  /** Paths (without query / fragment) under which the link counts as active. */
  activePaths: readonly string[];
}

/** A group of sidebar links shown as one tile that opens an `fpc-sidebar-popover` with the links. */
export interface FpcSidebarNavGroup<T extends FpcSidebarNavLink> {
  key: string;
  /** Bootstrap icon class of the group tile (e.g. `bi-receipt`). */
  icon: string;
  label: string;
  title: string;
  items: readonly T[];
}

/** Rendered sidebar entry: a plain link or a group tile with a popover. */
export type FpcSidebarNavEntry<T extends FpcSidebarNavLink> =
  | { kind: 'item'; key: string; item: T }
  | { kind: 'group'; key: string; group: FpcSidebarNavGroup<T> };

/**
 * Turns groups into sidebar entries: empty groups (all links hidden for the role / disabled features) disappear, a
 * group with a single link shows that link directly (no popover with one tile), larger groups become a popover tile.
 */
export function fpcSidebarNavEntries<T extends FpcSidebarNavLink>(
  groups: readonly FpcSidebarNavGroup<T>[],
): FpcSidebarNavEntry<T>[] {
  return groups.flatMap((group): FpcSidebarNavEntry<T>[] => {
    if (group.items.length === 0) {
      return [];
    }

    if (group.items.length === 1) {
      return [{ kind: 'item', key: group.key, item: group.items[0] }];
    }

    return [{ kind: 'group', key: group.key, group }];
  });
}

function pathOf(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

/** Whether the URL is on one of the link's pages (exact path or below it). */
export function fpcSidebarNavLinkActive(link: FpcSidebarNavLink, url: string): boolean {
  const path = pathOf(url);

  return link.activePaths.some((active) => path === active || path.startsWith(`${active}/`));
}

/** Whether the URL is on a page of one of the group's links (the group tile then shows as active). */
export function fpcSidebarNavGroupActive<T extends FpcSidebarNavLink>(
  group: FpcSidebarNavGroup<T>,
  url: string,
): boolean {
  return group.items.some((item) => fpcSidebarNavLinkActive(item, url));
}
