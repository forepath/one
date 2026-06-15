import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey } from 'typeorm';

/**
 * Migration to add user_id column to clients table.
 * This column stores the ID of the user who created the client.
 */
export class AddUserIdToClients1765100000000 implements MigrationInterface {
  name = 'AddUserIdToClients1765100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add user_id column
    await queryRunner.addColumn(
      'clients',
      new TableColumn({
        name: 'user_id',
        type: 'uuid',
        isNullable: true,
        comment: 'ID of the user who created this client',
      }),
    );

    // Create foreign key constraint
    await queryRunner.createForeignKey(
      'clients',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
        name: 'FK_clients_user_id',
      }),
    );

    // Create index for faster lookups
    await queryRunner.query(`CREATE INDEX "IDX_clients_user_id" ON "clients" ("user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_clients_user_id"`);

    // Drop foreign key
    await queryRunner.dropForeignKey('clients', 'FK_clients_user_id');

    // Drop column
    await queryRunner.dropColumn('clients', 'user_id');
  }
}
