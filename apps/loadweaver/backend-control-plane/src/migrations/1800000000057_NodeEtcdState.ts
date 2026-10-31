import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Split-brain-safe etcd bootstrap (3.43): which nodes hold etcd data (`etcd_member_since`, reported by the agents) and
 * whether the agent reported its etcd state since it last connected (`etcd_reported_at`). Members whose last report
 * applied the control-plane layer ran etcd before the agents reported it: they count as holding data until their
 * agent says otherwise, so no member bootstraps a second cluster next to theirs.
 */
/**
 * Backfill: only a last report of the node's current desired revision whose role is a voter (`member` / `witness`)
 * counts. A node promoted while offline last reported a revision without the role: its successful (`unchanged`)
 * control-plane step ran no etcd (live 3.43: two stopped dev nodes counted as holding data and blocked the bootstrap).
 */
export const ETCD_MEMBER_BACKFILL = `UPDATE "lw_nodes" n SET "etcd_member_since" = now()
  FROM "lw_node_desired_states" d
  WHERE d."node_name" = n."name" AND n."lifecycle" <> 'left' AND (n."control_plane" OR n."witness")
    AND n."last_report_revision" = d."revision"
    AND d."state" -> 'controlPlane' ->> 'role' IN ('member', 'witness')
    AND n."last_report_steps" @> '[{"layer":"control-plane"}]'::jsonb
    AND NOT n."last_report_steps" @> '[{"layer":"control-plane","status":"failed"}]'::jsonb`;

export class NodeEtcdState1800000000057 implements MigrationInterface {
  name = 'NodeEtcdState1800000000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "etcd_member_since" timestamptz`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "etcd_reported_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "etcd_bootstrap_at" timestamptz`);
    await queryRunner.query(ETCD_MEMBER_BACKFILL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "etcd_bootstrap_at"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "etcd_reported_at"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "etcd_member_since"`);
  }
}
