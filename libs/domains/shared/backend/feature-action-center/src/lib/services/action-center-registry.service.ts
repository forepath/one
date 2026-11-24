import { Injectable, Logger } from '@nestjs/common';

import { ACTION_CENTER_ITEM_TYPE_PATTERN } from '../constants/action-center.constants';
import type { ActionCenterSource } from '../interfaces/action-center.types';

/**
 * Sources of the action center. Products register them from their own module (where the sources' dependencies live),
 * usually in `onModuleInit` of a small registrar provider.
 */
@Injectable()
export class ActionCenterRegistry {
  private readonly logger = new Logger(ActionCenterRegistry.name);
  private readonly sources = new Map<string, ActionCenterSource>();
  private readonly typeOwners = new Map<string, string>();

  register(...sources: ActionCenterSource[]): void {
    for (const source of sources) {
      if (this.sources.has(source.key)) {
        throw new Error(`Action center source "${source.key}" is already registered`);
      }

      for (const type of source.types) {
        if (!ACTION_CENTER_ITEM_TYPE_PATTERN.test(type)) {
          throw new Error(`Action center source "${source.key}" declares an invalid item type "${type}"`);
        }

        const owner = this.typeOwners.get(type);

        if (owner) {
          throw new Error(`Action center item type "${type}" is declared by "${owner}" and "${source.key}"`);
        }
      }

      for (const type of source.types) {
        this.typeOwners.set(type, source.key);
      }

      this.sources.set(source.key, source);
      this.logger.debug(`Registered action center source ${source.key} (${source.types.length} types)`);
    }
  }

  list(): ActionCenterSource[] {
    return [...this.sources.values()];
  }

  isKnownType(type: string): boolean {
    return this.typeOwners.has(type);
  }

  /** Whether a reported type belongs to the source that reported it (sources may not report foreign types). */
  isOwnType(sourceKey: string, type: string): boolean {
    return this.typeOwners.get(type) === sourceKey;
  }
}
