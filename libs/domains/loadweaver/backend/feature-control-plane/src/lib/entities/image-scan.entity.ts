import { Column, Entity, PrimaryColumn } from 'typeorm';

export interface ImageScanSummary {
  /** Per severity: all findings, and those with a fixed version available. */
  counts: Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN', { total: number; fixable: number }>;
}

export interface ImageFinding {
  id: string;
  severity: string;
  package: string;
  installed: string;
  fixed: string | null;
}

/** The latest vulnerability scan of an image digest (3.22), reported by the node that pulled it. */
@Entity('lw_image_scans')
export class ImageScanEntity {
  @PrimaryColumn({ type: 'varchar', length: 80, name: 'digest' })
  digest!: string;

  @Column({ type: 'varchar', length: 512, name: 'image' })
  image!: string;

  @Column({ type: 'timestamptz', name: 'scanned_at' })
  scannedAt!: Date;

  @Column({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  @Column({ type: 'varchar', length: 64, name: 'scanner' })
  scanner!: string;

  @Column({ type: 'jsonb', name: 'summary' })
  summary!: ImageScanSummary;

  /** The most severe findings (capped). */
  @Column({ type: 'jsonb', name: 'findings' })
  findings!: ImageFinding[];
}
