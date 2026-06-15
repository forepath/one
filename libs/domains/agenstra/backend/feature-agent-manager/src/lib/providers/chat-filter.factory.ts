import { Injectable, Logger } from '@nestjs/common';

import { ChatFilter, FilterDirection } from './chat-filter.interface';

/**
 * Factory service for managing chat filters.
 * Supports multiple filter implementations with different directions.
 */
@Injectable()
export class ChatFilterFactory {
  private readonly logger = new Logger(ChatFilterFactory.name);
  private readonly filters = new Map<string, ChatFilter>();

  /**
   * Register a chat filter.
   * @param filter - The filter implementation to register
   */
  registerFilter(filter: ChatFilter): void {
    const type = filter.getType();

    if (this.filters.has(type)) {
      this.logger.warn(`Filter with type '${type}' is already registered. Overwriting existing filter.`);
    }

    this.filters.set(type, filter);
    this.logger.log(`Registered chat filter: ${type} (${filter.getDirection()})`);
  }

  /**
   * Get all filters that apply to a specific direction.
   * @param direction - The filter direction to get filters for
   * @returns Array of filters that apply to the specified direction
   */
  getFiltersByDirection(direction: FilterDirection): ChatFilter[] {
    const filters: ChatFilter[] = [];

    for (const filter of this.filters.values()) {
      const filterDirection = filter.getDirection();

      if (filterDirection === direction || filterDirection === FilterDirection.BIDIRECTIONAL) {
        filters.push(filter);
      }
    }

    return filters;
  }

  /**
   * Get all registered filters.
   * @returns Array of all registered filters
   */
  getAllFilters(): ChatFilter[] {
    return Array.from(this.filters.values());
  }

  /**
   * Get a filter by type.
   * @param type - The filter type identifier
   * @returns The filter instance if found
   * @throws Error if filter is not found
   */
  getFilter(type: string): ChatFilter {
    const filter = this.filters.get(type);

    if (!filter) {
      const availableTypes = Array.from(this.filters.keys()).join(', ');

      throw new Error(`Chat filter with type '${type}' not found. Available types: ${availableTypes || 'none'}`);
    }

    return filter;
  }

  /**
   * Check if a filter type is registered.
   * @param type - The filter type identifier
   * @returns True if filter is registered, false otherwise
   */
  hasFilter(type: string): boolean {
    return this.filters.has(type);
  }

  /**
   * Get all registered filter types.
   * @returns Array of registered filter type strings
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.filters.keys());
  }
}
