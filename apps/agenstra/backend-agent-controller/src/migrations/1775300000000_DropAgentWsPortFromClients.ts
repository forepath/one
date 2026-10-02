import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Drop obsolete agent_ws_port: HTTP and WebSocket share the client endpoint port.
 */
export class DropAgentWsPortFromClients1775300000000 implements MigrationInterface {
  name = 'DropAgentWsPortFromClients1775300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('clients', 'agent_ws_port');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'clients',
      new TableColumn({
        name: 'agent_ws_port',
        type: 'int',
        isNullable: true,
      }),
    );
  }
}
