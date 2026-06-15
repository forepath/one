import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentMessageEventsTable1768000000000 implements MigrationInterface {
  name = 'CreateAgentMessageEventsTable1768000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "agent_message_events" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "agent_id" uuid NOT NULL,
                "correlation_id" character varying(64) NOT NULL,
                "sequence" integer NOT NULL,
                "kind" character varying(64) NOT NULL,
                "payload" jsonb NOT NULL,
                "event_timestamp" timestamptz NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_agent_message_events_id" PRIMARY KEY ("id"),
                CONSTRAINT "FK_agent_message_events_agent_id" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT "UQ_agent_message_events_agent_corr_seq" UNIQUE ("agent_id", "correlation_id", "sequence")
            );
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_agent_message_events_agent_corr" ON "agent_message_events" ("agent_id", "correlation_id");
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_message_events_agent_corr";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_message_events";`);
  }
}
