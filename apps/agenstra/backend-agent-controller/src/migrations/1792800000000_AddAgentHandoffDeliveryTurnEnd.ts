import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * End of the turn a delivered handoff response started in the requesting chat: handoffs created during that turn
 * continue the chain (depth), later ones in the same chat do not.
 */
export class AddAgentHandoffDeliveryTurnEnd1792800000000 implements MigrationInterface {
  name = 'AddAgentHandoffDeliveryTurnEnd1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_handoffs" ADD COLUMN IF NOT EXISTS "delivery_turn_ended_at" TIMESTAMPTZ`,
    );
    // Responses delivered before this migration: their turns are over.
    await queryRunner.query(
      `UPDATE "agent_handoffs" SET "delivery_turn_ended_at" = "delivered_at" WHERE "delivered_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_handoffs" DROP COLUMN IF EXISTS "delivery_turn_ended_at"`);
  }
}
