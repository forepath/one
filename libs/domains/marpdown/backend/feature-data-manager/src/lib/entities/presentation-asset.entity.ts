import { createAes256GcmTransformer } from '@forepath/shared/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { PresentationEntity } from './presentation.entity';

@Entity('presentation_assets')
@Unique('uq_presentation_assets_presentation_path', ['presentationId', 'path'])
export class PresentationAssetEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'presentation_id' })
  presentationId!: string;

  @ManyToOne(() => PresentationEntity, (presentation) => presentation.assets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'presentation_id' })
  presentation!: PresentationEntity;

  @Column({ type: 'varchar', length: 1024, name: 'path' })
  path!: string;

  @Column({
    type: 'text',
    name: 'content',
    transformer: createAes256GcmTransformer(),
  })
  content!: string;

  @Column({ type: 'varchar', length: 255, name: 'mime_type' })
  mimeType!: string;

  @Column({ type: 'int', name: 'size_bytes' })
  sizeBytes!: number;

  @Column({ type: 'boolean', name: 'is_directory', default: false })
  isDirectory!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
