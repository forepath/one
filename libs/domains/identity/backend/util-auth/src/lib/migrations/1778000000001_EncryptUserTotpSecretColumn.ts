import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Widen totp_secret for AES-256-GCM ciphertext (iv:tag:data base64).
 * Encryption is applied by the entity transformer on write; existing plaintext
 * values remain readable until next update (transformer supports legacy format).
 */
export class EncryptUserTotpSecretColumn1778000000001 implements MigrationInterface {
  name = 'EncryptUserTotpSecretColumn1778000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      'users',
      'totp_secret',
      new TableColumn({
        name: 'totp_secret',
        type: 'varchar',
        length: '2048',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      'users',
      'totp_secret',
      new TableColumn({
        name: 'totp_secret',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  }
}
