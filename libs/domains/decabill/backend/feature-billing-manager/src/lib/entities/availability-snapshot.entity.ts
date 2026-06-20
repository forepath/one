import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('billing_availability_snapshots')
export class AvailabilitySnapshotEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 100, name: 'provider' })
  provider!: string;

  @Column({ type: 'varchar', length: 100, name: 'region' })
  region!: string;

  @Column({ type: 'varchar', length: 100, name: 'server_type' })
  serverType!: string;

  @Column({ type: 'boolean', name: 'is_available' })
  isAvailable!: boolean;

  @Column({ type: 'jsonb', name: 'raw_response', default: () => "'{}'::jsonb" })
  rawResponse!: Record<string, unknown>;

  @CreateDateColumn({ name: 'captured_at' })
  capturedAt!: Date;
}
