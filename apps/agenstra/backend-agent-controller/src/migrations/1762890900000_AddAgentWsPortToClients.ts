import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAgentWsPortToClients1762890900000 implements MigrationInterface {
  name = 'AddAgentWsPortToClients1762890900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'clients',
      new TableColumn({
        name: 'agent_ws_port',
        type: 'int',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('clients', 'agent_ws_port');
  }
}
