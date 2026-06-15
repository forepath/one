import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add SSH-related columns to agents table.
 * This migration adds support for SSH container management:
 * - ssh_container_id: ID of the SSH container associated with the agent
 * - ssh_host_port: Host port mapped to the SSH container's SSH port
 * - ssh_password: Encrypted password for SSH authentication (encrypted at application level)
 */
export class AddSshColumnsToAgentsTable1766235595330 implements MigrationInterface {
  name = 'AddSshColumnsToAgentsTable1766235595330';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add ssh_container_id column
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'ssh_container_id',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    // Add ssh_host_port column
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'ssh_host_port',
        type: 'integer',
        isNullable: true,
      }),
    );

    // Add ssh_password column
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove SSH-related columns in reverse order
    await queryRunner.dropColumn('agents', 'ssh_password');
    await queryRunner.dropColumn('agents', 'ssh_host_port');
    await queryRunner.dropColumn('agents', 'ssh_container_id');
  }
}
