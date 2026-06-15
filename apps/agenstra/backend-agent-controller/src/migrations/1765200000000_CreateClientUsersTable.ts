import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Migration to create the client_users table.
 * This table holds a many-to-many relationship between users and clients,
 * allowing multiple users to have access to a client with different roles.
 */
export class CreateClientUsersTable1765200000000 implements MigrationInterface {
  name = 'CreateClientUsersTable1765200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create client_user_role enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "client_user_role_enum" AS ENUM ('admin', 'user');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create client_users table
    await queryRunner.createTable(
      new Table({
        name: 'client_users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'client_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'role',
            type: 'enum',
            enum: ['admin', 'user'],
            enumName: 'client_user_role_enum',
            isNullable: false,
            default: "'user'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create foreign key to users table
    await queryRunner.createForeignKey(
      'client_users',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_client_users_user_id',
      }),
    );

    // Create foreign key to clients table
    await queryRunner.createForeignKey(
      'client_users',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_client_users_client_id',
      }),
    );

    // Create unique constraint to prevent duplicate user-client relationships
    await queryRunner.createUniqueConstraint(
      'client_users',
      new TableUnique({
        name: 'uq_client_users_user_client',
        columnNames: ['user_id', 'client_id'],
      }),
    );

    // Create indexes for faster lookups
    await queryRunner.createIndex(
      'client_users',
      new TableIndex({
        name: 'IDX_client_users_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'client_users',
      new TableIndex({
        name: 'IDX_client_users_client_id',
        columnNames: ['client_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex('client_users', 'IDX_client_users_client_id');
    await queryRunner.dropIndex('client_users', 'IDX_client_users_user_id');

    // Drop unique constraint
    await queryRunner.dropUniqueConstraint('client_users', 'uq_client_users_user_client');

    // Drop foreign keys
    await queryRunner.dropForeignKey('client_users', 'FK_client_users_client_id');
    await queryRunner.dropForeignKey('client_users', 'FK_client_users_user_id');

    // Drop table
    await queryRunner.dropTable('client_users');

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS "client_user_role_enum"`);
  }
}
