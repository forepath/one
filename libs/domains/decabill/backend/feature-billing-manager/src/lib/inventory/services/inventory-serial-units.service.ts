import { Injectable } from '@nestjs/common';

import type { InventorySerialUnitResponseDto, PaginatedInventoryResponseDto } from '../dto/inventory.dto';
import {
  type InventorySerialUnitFilters,
  InventorySerialUnitsRepository,
} from '../repositories/inventory-serial-units.repository';
import { mapSerialUnit } from '../utils/inventory-mappers';
import { inventoryPage } from '../utils/inventory-query.utils';

/** Serial-tracked units: where each one is (compartment, lending) for lists, pickers and lookups by serial number. */
@Injectable()
export class InventorySerialUnitsService {
  constructor(private readonly serialUnits: InventorySerialUnitsRepository) {}

  async list(
    limit: number | undefined,
    offset: number | undefined,
    filters: InventorySerialUnitFilters,
  ): Promise<PaginatedInventoryResponseDto<InventorySerialUnitResponseDto>> {
    const page = inventoryPage(limit, offset);
    const { items, total } = await this.serialUnits.findAll(page.limit, page.offset, filters);

    return { items: items.map(mapSerialUnit), total };
  }
}
