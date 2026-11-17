import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Counters for inventory numbers: article numbers (`kind = 'ART'`, `year = 0`) and movement documents
 * (`kind = PUT | TRF | WDR`, per year). Keyed by the number scope (shared or tenant, see TENANTS_SHARED_NUMBERS).
 */
@Entity('billing_inventory_number_sequences')
export class InventoryNumberSequenceEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'scope_key' })
  scopeKey!: string;

  @PrimaryColumn({ type: 'varchar', length: 8, name: 'kind' })
  kind!: string;

  @PrimaryColumn({ type: 'int', name: 'year' })
  year!: number;

  @Column({ type: 'int', default: 0, name: 'last_value' })
  lastValue!: number;
}
