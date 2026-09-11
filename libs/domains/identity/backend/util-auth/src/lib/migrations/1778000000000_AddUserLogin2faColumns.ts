import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUserLogin2faColumns1778000000000 implements MigrationInterface {
  name = 'AddUserLogin2faColumns1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'totp_secret',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'totp_enabled_at',
        type: 'timestamp',
        isNullable: true,
        comment: 'null = authenticator not enrolled; non-null = TOTP 2FA active',
      }),
    );
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'email_2fa_enabled_at',
        type: 'timestamp',
        isNullable: true,
        comment: 'null = email 2FA not opted in; non-null = email OTP required when force is off',
      }),
    );
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'login_2fa_email_token',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'login_2fa_email_token_expires_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'login_2fa_email_token_expires_at');
    await queryRunner.dropColumn('users', 'login_2fa_email_token');
    await queryRunner.dropColumn('users', 'email_2fa_enabled_at');
    await queryRunner.dropColumn('users', 'totp_enabled_at');
    await queryRunner.dropColumn('users', 'totp_secret');
  }
}
