import { UserEntity } from '@forepath/identity/backend';
import { createAes256GcmTransformer } from '@forepath/shared/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PresentationAssetEntity } from './presentation-asset.entity';

@Entity('presentations')
export class PresentationEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ type: 'varchar', length: 500, name: 'title' })
  title!: string;

  @Column({
    type: 'text',
    name: 'markdown',
    transformer: createAes256GcmTransformer(),
  })
  markdown!: string;

  @OneToMany(() => PresentationAssetEntity, (asset) => asset.presentation)
  assets!: PresentationAssetEntity[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
