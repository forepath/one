import { findTakedown, type CatalogIndex, type CatalogTakedown } from './catalog-index';

/** What an installed app records about its origin (`Deployment` metadata `app`). */
export interface InstalledAppRef {
  /** Catalog name as configured in `Cluster.spec.appStore.catalogs`. */
  catalog: string;
  name: string;
  version: string;
}

export interface AffectedInstall<T extends InstalledAppRef> {
  install: T;
  takedown: CatalogTakedown;
}

/**
 * Installs hit by the index's takedowns. Only installs from `catalog` (the configured name the index was fetched
 * for; defaults to the index's own catalog name) are matched; extra fields of the installs are passed through.
 */
export function findAffectedInstalls<T extends InstalledAppRef>(
  index: CatalogIndex,
  installs: readonly T[],
  catalog: string = index.catalog.name,
): AffectedInstall<T>[] {
  return installs.flatMap((install) => {
    if (install.catalog !== catalog) return [];

    const takedown = findTakedown(index, install.name, install.version);

    return takedown ? [{ install, takedown }] : [];
  });
}
