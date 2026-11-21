import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { CsvColumnMapping } from '../bank-import/bank-import.types';

/** Admin-saved CSV column mapping (built-in presets live in code). */
@Entity('billing_accounting_csv_mappings')
export class AccountingCsvMappingEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tenant_id' })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'jsonb', name: 'mapping' })
  mapping!: CsvColumnMapping;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
