import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds tenant_id to users for multi-tenant billing.
 * Email and keycloak_sub uniqueness become per-tenant.
 */
export class AddTenantIdToUsers1770550000000 implements MigrationInterface {
  name = 'AddTenantIdToUsers1770550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTenantId = await queryRunner.hasColumn('users', 'tenant_id');

    if (!hasTenantId) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'tenant_id',
          type: 'varchar',
          length: '64',
          isNullable: false,
          default: "'default'",
        }),
      );
    }

    await queryRunner.query(`
      DO $$ DECLARE constraint_name text;
      BEGIN
        FOR constraint_name IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'users'
            AND c.contype = 'u'
            AND array_length(c.conkey, 1) = 1
            AND EXISTS (
              SELECT 1
              FROM pg_attribute a
              WHERE a.attrelid = t.oid
                AND a.attnum = c.conkey[1]
                AND a.attname = 'email'
            )
        LOOP
          EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
        END LOOP;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ DECLARE constraint_name text;
      BEGIN
        FOR constraint_name IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'users'
            AND c.contype = 'u'
            AND array_length(c.conkey, 1) = 1
            AND EXISTS (
              SELECT 1
              FROM pg_attribute a
              WHERE a.attrelid = t.oid
                AND a.attnum = c.conkey[1]
                AND a.attname = 'keycloak_sub'
            )
        LOOP
          EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
        END LOOP;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_tenant_email'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT uq_users_tenant_email UNIQUE (tenant_id, email);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_tenant_keycloak_sub"
      ON "users" ("tenant_id", "keycloak_sub")
      WHERE "keycloak_sub" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_tenant_id" ON "users" ("tenant_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_tenant_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_tenant_keycloak_sub"`);
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_tenant_email`);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_email'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_keycloak_sub'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT uq_users_keycloak_sub UNIQUE (keycloak_sub);
        END IF;
      END $$;
    `);

    if (await queryRunner.hasColumn('users', 'tenant_id')) {
      await queryRunner.dropColumn('users', 'tenant_id');
    }
  }
}
