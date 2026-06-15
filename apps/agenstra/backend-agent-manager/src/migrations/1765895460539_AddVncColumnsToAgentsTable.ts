import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add VNC-related columns to agents table.
 * This migration adds support for VNC container management:
 * - vnc_container_id: ID of the VNC container associated with the agent
 * - vnc_host_port: Host port mapped to the VNC container's VNC port
 * - vnc_network_id: ID of the Docker network used for VNC connectivity
 */
export class AddVncColumnsToAgentsTable1765895460539 implements MigrationInterface {
  name = 'AddVncColumnsToAgentsTable1765895460539';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add vnc_container_id column
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'vnc_container_id',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    // Add vnc_host_port column
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'vnc_host_port',
        type: 'integer',
        isNullable: true,
      }),
    );

    // Add vnc_network_id column
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'vnc_network_id',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove VNC-related columns in reverse order
    await queryRunner.dropColumn('agents', 'vnc_network_id');
    await queryRunner.dropColumn('agents', 'vnc_host_port');
    await queryRunner.dropColumn('agents', 'vnc_container_id');
  }
}
