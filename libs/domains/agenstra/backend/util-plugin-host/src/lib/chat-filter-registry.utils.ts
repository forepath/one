import { ProviderRegistry } from '@forepath/shared/backend/util-extension-core';

import type { ChatFilter } from './contracts/chat-filter.interface';
import { FilterDirection } from './contracts/chat-filter.interface';

export function getChatFiltersByDirection(
  registry: ProviderRegistry<ChatFilter>,
  direction: FilterDirection,
): ChatFilter[] {
  const filters: ChatFilter[] = [];

  for (const filter of registry.getAll()) {
    const filterDirection = filter.getDirection();

    if (filterDirection === direction || filterDirection === FilterDirection.BIDIRECTIONAL) {
      filters.push(filter);
    }
  }

  return filters;
}
