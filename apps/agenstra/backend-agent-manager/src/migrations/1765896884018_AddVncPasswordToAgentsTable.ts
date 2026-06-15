import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add vnc_password column to agents table.
 * This migration adds support for storing encrypted VNC passwords:
 * - vnc_password: Encrypted password for VNC authentication (encrypted at application level)
 */
export class AddVncPasswordToAgentsTable1765896884018 implements MigrationInterface {
  name = 'AddVncPasswordToAgentsTable1765896884018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add vnc_password column
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'vnc_password',
        type: 'varchar',
        length: '1024',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove vnc_password column
    await queryRunner.dropColumn('agents', 'vnc_password');
  }
}
