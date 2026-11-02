import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Volume follow-ups of the first real-DRBD VM lab run (M6): the agent-reported kernel host name per node (DRBD `on`
 * sections) and stable DRBD node ids per volume replica holder. Existing placements keep the ids they were rendered
 * with so far (position in primary → sync replicas → remote replicas).
 */
export class VolumeDrbdIdentity1800000000036 implements MigrationInterface {
  name = 'VolumeDrbdIdentity1800000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_nodes" ADD COLUMN IF NOT EXISTS "hostname" varchar(64)`);
    await queryRunner.query(
      `ALTER TABLE "lw_volume_placements" ADD COLUMN IF NOT EXISTS "drbd_node_ids" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "lw_volume_placements" ADD COLUMN IF NOT EXISTS "drbd_next_node_id" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      UPDATE "lw_volume_placements" v
         SET "drbd_node_ids" = ids.map, "drbd_next_node_id" = ids.count
        FROM (
          SELECT p."id", jsonb_object_agg(h.node, h.position - 1) AS map, count(*)::integer AS count
            FROM "lw_volume_placements" p,
                 jsonb_array_elements_text(jsonb_build_array(p."primary_node") || p."sync_replicas" || p."remote_replicas")
                   WITH ORDINALITY AS h(node, position)
           GROUP BY p."id"
        ) ids
       WHERE v."id" = ids."id" AND v."drbd_node_ids" = '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lw_volume_placements" DROP COLUMN IF EXISTS "drbd_next_node_id"`);
    await queryRunner.query(`ALTER TABLE "lw_volume_placements" DROP COLUMN IF EXISTS "drbd_node_ids"`);
    await queryRunner.query(`ALTER TABLE "lw_nodes" DROP COLUMN IF EXISTS "hostname"`);
  }
}
