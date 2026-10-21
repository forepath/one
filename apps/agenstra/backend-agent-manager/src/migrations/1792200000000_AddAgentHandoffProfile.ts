import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Handoff profile of an environment: its responsibilities and what it can take over from other agents of the
 * workspace (read by peers through `agenstra_handoff_agents`).
 */
export class AddAgentHandoffProfile1792200000000 implements MigrationInterface {
  name = 'AddAgentHandoffProfile1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('agents', new TableColumn({ name: 'handoff_profile', type: 'text', isNullable: true }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'handoff_profile');
  }
}
