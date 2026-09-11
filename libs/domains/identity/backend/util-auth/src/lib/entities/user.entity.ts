import { createAes256GcmTransformer } from '@shared/backend/util-crypto';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Canonical UserRole enum for all applications.
 * - USER: Regular user
 * - ADMIN: Administrator
 * - CONTROLLER: Controller-level access (used by agent-manager)
 */
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  CONTROLLER = 'controller',
}

/**
 * User entity for the "users" authentication method.
 * Passwords are stored as bcrypt hashes (never use encryption transformer).
 * Keycloak-linked users have keycloak_sub set and password_hash null.
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255, name: 'email' })
  email!: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash', nullable: true })
  passwordHash?: string;

  @Column({ type: 'varchar', length: 50, name: 'role', default: UserRole.USER })
  role!: UserRole;

  @Column({ type: 'timestamp', name: 'email_confirmed_at', nullable: true })
  emailConfirmedAt?: Date;

  @Column({ type: 'timestamp', name: 'locked_at', nullable: true })
  lockedAt?: Date | null;

  @Column({ type: 'int', name: 'token_version', default: 0 })
  tokenVersion!: number;

  @Column({ type: 'varchar', length: 255, name: 'email_confirmation_token', nullable: true })
  emailConfirmationToken?: string;

  @Column({ type: 'varchar', length: 255, name: 'password_reset_token', nullable: true })
  passwordResetToken?: string;

  @Column({ type: 'timestamp', name: 'password_reset_token_expires_at', nullable: true })
  passwordResetTokenExpiresAt?: Date;

  @Column({ type: 'varchar', length: 255, name: 'keycloak_sub', nullable: true })
  keycloakSub?: string;

  /**
   * Base32 TOTP secret while pending enrollment or enabled.
   * Stored encrypted at rest (AES-256-GCM); decrypted transparently via transformer.
   * Legacy plaintext values (pre-encryption) are still readable by the transformer.
   */
  @Column({
    type: 'varchar',
    length: 2048,
    name: 'totp_secret',
    nullable: true,
    transformer: createAes256GcmTransformer(),
  })
  totpSecret?: string | null;

  /** Set when authenticator 2FA is confirmed once; null means not enrolled. */
  @Column({ type: 'timestamp', name: 'totp_enabled_at', nullable: true })
  totpEnabledAt?: Date | null;

  /** Set when the user opts into email 2FA (force path does not require this). */
  @Column({ type: 'timestamp', name: 'email_2fa_enabled_at', nullable: true })
  email2faEnabledAt?: Date | null;

  /** Bcrypt hash of the current login email OTP. */
  @Column({ type: 'varchar', length: 255, name: 'login_2fa_email_token', nullable: true })
  login2faEmailToken?: string | null;

  @Column({ type: 'timestamp', name: 'login_2fa_email_token_expires_at', nullable: true })
  login2faEmailTokenExpiresAt?: Date | null;

  /**
   * Day of month (1-28) when the user is billed for open positions. Null means use registration day (createdAt), capped at 28.
   */
  @Column({ type: 'int', name: 'billing_day_of_month', nullable: true })
  billingDayOfMonth?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
