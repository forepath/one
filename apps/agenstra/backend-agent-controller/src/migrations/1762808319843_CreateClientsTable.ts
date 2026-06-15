import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Initial migration to create the clients table.
 * This migration creates the clients table with all required columns and constraints
 * based on the ClientEntity definition.
 */
export class CreateClientsTable1762808319843 implements MigrationInterface {
  name = 'CreateClientsTable1762808319843';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension for PostgreSQL (if not already enabled)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Create authentication_type enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "authentication_type_enum" AS ENUM ('api_key', 'keycloak');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create clients table
    await queryRunner.createTable(
      new Table({
        name: 'clients',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'endpoint',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'authentication_type',
            type: 'enum',
            enum: ['api_key', 'keycloak'],
            enumName: 'authentication_type_enum',
            isNullable: false,
          },
          {
            name: 'api_key',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'keycloak_client_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'keycloak_client_secret',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'keycloak_realm',
            type: 'varchar',
            length: '255',
            isNullable: true,
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

    // Create index on name column for faster lookups
    await queryRunner.createIndex(
      'clients',
      new TableIndex({
        name: 'IDX_clients_name',
        columnNames: ['name'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.dropIndex('clients', 'IDX_clients_name');

    // Drop table
    await queryRunner.dropTable('clients');

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS "authentication_type_enum"`);
  }
}
