import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Drop VNC and SSH sidecar columns from agents table.
 * Remote desktop and SSH sidecar containers are no longer supported.
 */
export class DropVncAndSshColumnsFromAgentsTable1783000000000 implements MigrationInterface {
  name = 'DropVncAndSshColumnsFromAgentsTable1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'ssh_password');
    await queryRunner.dropColumn('agents', 'ssh_host_port');
    await queryRunner.dropColumn('agents', 'ssh_container_id');
    await queryRunner.dropColumn('agents', 'vnc_password');
    await queryRunner.dropColumn('agents', 'vnc_network_id');
    await queryRunner.dropColumn('agents', 'vnc_host_port');
    await queryRunner.dropColumn('agents', 'vnc_container_id');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'vnc_container_id',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'vnc_host_port',
        type: 'integer',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'vnc_network_id',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'vnc_password',
        type: 'varchar',
        length: '1024',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'ssh_container_id',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'ssh_host_port',
        type: 'integer',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'ssh_password',
        type: 'varchar',
        length: '1024',
        isNullable: true,
      }),
    );
  }
}
