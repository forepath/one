import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds browser_preview_enabled to agents.
 * Existing agents with a VNC sidecar get preview enabled (VNC implies preview).
 */
export class AddBrowserPreviewEnabledToAgentsTable1780000000000 implements MigrationInterface {
  name = 'AddBrowserPreviewEnabledToAgentsTable1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'agents',
      new TableColumn({
        name: 'browser_preview_enabled',
        type: 'boolean',
        isNullable: false,
        default: false,
      }),
    );

    await queryRunner.query(`
      UPDATE agents
      SET browser_preview_enabled = true
      WHERE vnc_container_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('agents', 'browser_preview_enabled');
  }
}
