import { BadRequestException } from '@nestjs/common';

import type { InventoryArticlesRepository } from '../repositories/inventory-articles.repository';

/**
 * Article positions (invoice / offer lines, plan articles) must reference articles of the request tenant. The
 * repository lookup is tenant-scoped, so a foreign tenant's article counts as unknown.
 */
export async function assertInventoryArticlesExist(
  repository: InventoryArticlesRepository,
  articleIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(articleIds.filter((id): id is string => Boolean(id)))];

  if (ids.length === 0) {
    return;
  }

  const found = new Set((await repository.findByIds(ids)).map((article) => article.id));
  const missing = ids.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new BadRequestException(`Unknown inventory article: ${missing.join(', ')}`);
  }
}
