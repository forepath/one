import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { ImageInspection } from '../utils/microvm-planning.utils';

/**
 * What a deployment was last applied with (3.22): images pinned to digests and secret versions. Re-resolving
 * (new image digests, rotated secrets) is a plan.
 */
@Entity('lw_deployment_states')
export class DeploymentStateEntity {
  /** `project/deployment` */
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'id' })
  id!: string;

  /** service → `image@sha256:...` */
  @Column({ type: 'jsonb', name: 'images', default: () => "'{}'" })
  images!: Record<string, string>;

  /** `secret://project/name` → version */
  @Column({ type: 'jsonb', name: 'secret_versions', default: () => "'{}'" })
  secretVersions!: Record<string, number>;

  /**
   * service → what the image resolver read from the pinned image at plan time (3.35): labels, process config and
   * layers of microVM images, the disk layer of VM image artifacts. Empty for container-only deployments.
   */
  @Column({ type: 'jsonb', name: 'image_configs', default: () => "'{}'" })
  imageConfigs!: Record<string, ImageInspection>;

  /** Increments on every apply of the deployment; one-off jobs run once per generation (3.23). */
  @Column({ type: 'integer', name: 'generation', default: 0 })
  generation!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
