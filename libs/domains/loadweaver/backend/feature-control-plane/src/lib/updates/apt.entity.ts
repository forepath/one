import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import type { AptUpstream } from '@forepath/loadweaver/shared/util-release';

/** A frozen apt index (3.26): `InRelease` / `Packages` of each source at plan time, served to the nodes as they are. */
@Entity('lw_apt_snapshots')
export class AptSnapshotEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'id' })
  id!: string;

  /** Per source: the upstream base URL and suites / components / architectures. */
  @Column({ type: 'jsonb', name: 'sources' })
  sources!: AptUpstream[];

  /** Index files: `<source>/dists/…` → SHA-256 + size (content in the artifact store). */
  @Column({ type: 'jsonb', name: 'files' })
  files!: Record<string, { sha256: string; size: number }>;

  @Column({ type: 'varchar', length: 16, name: 'origin' })
  origin!: 'plan' | 'bundle';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** Package files of the cluster-local apt source by upstream path (content in the artifact store, by checksum). */
@Entity('lw_apt_files')
export class AptFileEntity {
  @PrimaryColumn({ type: 'varchar', length: 300, name: 'source_url' })
  sourceUrl!: string;

  @PrimaryColumn({ type: 'varchar', length: 400, name: 'path' })
  path!: string;

  @Column({ type: 'varchar', length: 64, name: 'sha256' })
  sha256!: string;

  @Column({ type: 'bigint', name: 'size' })
  size!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
