import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cached official MCP Registry server entry (latest version).
 * Refreshed by BullMQ job `opencode-mcp-servers.refresh`.
 */
@Entity('opencode_mcp_servers')
export class OpencodeMcpServerEntity {
  /** Reverse-DNS server name from the registry (`io.github.user/weather`). */
  @PrimaryColumn({ type: 'varchar', length: 200, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 256, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 512, name: 'description' })
  description!: string;

  @Column({ type: 'varchar', length: 255, name: 'version' })
  version!: string;

  /** Registry lifecycle status: active | deprecated | deleted. */
  @Column({ type: 'varchar', length: 32, name: 'status', default: 'active' })
  status!: string;

  @Column({ type: 'varchar', length: 1024, nullable: true, name: 'website_url' })
  websiteUrl?: string | null;

  @Column({ type: 'jsonb', name: 'packages', default: () => "'[]'::jsonb" })
  packages!: unknown[];

  @Column({ type: 'jsonb', name: 'remotes', default: () => "'[]'::jsonb" })
  remotes!: unknown[];

  @Column({ type: 'jsonb', nullable: true, name: 'repository' })
  repository?: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'published_at' })
  publishedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'registry_updated_at' })
  registryUpdatedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
