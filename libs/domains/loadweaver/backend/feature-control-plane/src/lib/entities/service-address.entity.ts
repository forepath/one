import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Stable service IPs that follow a service across nodes (3.4). */
@Entity('lw_service_addresses')
export class ServiceAddressEntity {
  /** `project/deployment/service` */
  @PrimaryColumn({ type: 'varchar', length: 200, name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 45, name: 'address_v4', nullable: true })
  addressV4!: string | null;

  @Column({ type: 'varchar', length: 45, name: 'address_v6', nullable: true })
  addressV6!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
