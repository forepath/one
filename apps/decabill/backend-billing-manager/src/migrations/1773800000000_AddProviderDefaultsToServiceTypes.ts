import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds encrypted provider_defaults column for per-service-type platform credential overrides.
 */
export class AddProviderDefaultsToServiceTypes1773800000000 implements MigrationInterface {
  name = 'AddProviderDefaultsToServiceTypes1773800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'billing_service_types',
      new TableColumn({
        name: 'provider_defaults',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('billing_service_types', 'provider_defaults');
  }
}
