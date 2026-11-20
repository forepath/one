import type { AdminInventoryService } from '@forepath/decabill/frontend/data-access-billing-console';
import { catchError, forkJoin, map, type Observable, of, switchMap } from 'rxjs';

import { INVENTORY_SERIALS_PER_MOVEMENT_MAX } from './inventory-serial-input.component';

const PAGE_SIZE = 100;

/** Serial numbers of an article's units in stock in a compartment (at most one movement's worth, paged requests). */
export function loadInventorySerialsInStock(
  service: AdminInventoryService,
  articleId: string,
  compartmentId: string,
): Observable<string[]> {
  const query = { articleId, compartmentId, status: 'in_stock' as const, limit: PAGE_SIZE };

  return service.listSerialUnits({ ...query, offset: 0 }).pipe(
    switchMap((first) => {
      const pages = Math.min(Math.ceil(first.total / PAGE_SIZE), INVENTORY_SERIALS_PER_MOVEMENT_MAX / PAGE_SIZE);
      const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
        service.listSerialUnits({ ...query, offset: (index + 1) * PAGE_SIZE }),
      );

      return rest.length > 0
        ? forkJoin(rest).pipe(map((more) => [first, ...more].flatMap((page) => page.items)))
        : of(first.items);
    }),
    map((units) => units.map((unit) => unit.serialNumber)),
    catchError(() => of([] as string[])),
  );
}
