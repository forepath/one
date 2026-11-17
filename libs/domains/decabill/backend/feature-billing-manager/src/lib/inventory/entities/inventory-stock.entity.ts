import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { InventoryArticleEntity } from './inventory-article.entity';
import { InventoryCompartmentEntity } from './inventory-compartment.entity';

/**
 * Article placement in a compartment with its on-hand quantity. A placement may hold quantity 0 (mapped location
 * without stock). Quantities only change through movements (documents).
 */
@Entity('billing_inventory_stock')
@Index('uq_billing_inventory_stock_compartment_article', ['compartmentId', 'articleId'], { unique: true })
export class InventoryStockEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'uuid', name: 'compartment_id' })
  compartmentId!: string;

  @ManyToOne(() => InventoryCompartmentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'compartment_id' })
  compartment?: InventoryCompartmentEntity;

  @Column({ type: 'uuid', name: 'article_id' })
  articleId!: string;

  @ManyToOne(() => InventoryArticleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'article_id' })
  article?: InventoryArticleEntity;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0, name: 'quantity' })
  quantity!: number | string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
