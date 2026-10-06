import { ColumnEncryptor } from './encryption';
import { PasswordHasher } from './passwords';
import { DemoRandom } from './random';
import { DEMO_EMAIL_CODE, DEMO_PASSWORD, DEMO_TOTP_SECRET } from './seeder';
import { json, SqlRow } from './sql';

export type DemoUserRole = 'admin' | 'user' | 'controller';

/**
 * One entry per account state supported by the identity `users` table (shared by Decabill and
 * Agenstra). Login behaviour per state is defined in identity `auth.service.ts`.
 */
export interface AccountStateTemplate {
  key: string;
  role: DemoUserRole;
  description: string;
  confirmed: boolean;
  locked?: boolean;
  totp?: boolean;
  email2fa?: boolean;
  passwordResetPending?: boolean;
  passwordResetExpired?: boolean;
  /** Keycloak-linked account without local password. */
  external?: boolean;
  /** Sessions were invalidated (logout everywhere / credential change). */
  bumpedTokenVersion?: boolean;
  billingDayOfMonth?: number;
}

export const ACCOUNT_STATES: readonly AccountStateTemplate[] = [
  { key: 'admin', role: 'admin', description: 'Administrator', confirmed: true },
  {
    key: 'admin-totp',
    role: 'admin',
    description: 'Administrator with authenticator app',
    confirmed: true,
    totp: true,
  },
  { key: 'user', role: 'user', description: 'Active user', confirmed: true },
  { key: 'user-email-2fa', role: 'user', description: 'User with email 2FA opt-in', confirmed: true, email2fa: true },
  { key: 'user-totp', role: 'user', description: 'User with authenticator app', confirmed: true, totp: true },
  { key: 'user-unconfirmed', role: 'user', description: 'Registered, email not confirmed', confirmed: false },
  { key: 'user-locked', role: 'user', description: 'Locked account', confirmed: true, locked: true },
  {
    key: 'user-password-reset',
    role: 'user',
    description: 'Password reset requested',
    confirmed: true,
    passwordResetPending: true,
  },
  {
    key: 'user-password-reset-expired',
    role: 'user',
    description: 'Password reset link expired',
    confirmed: true,
    passwordResetExpired: true,
  },
  { key: 'user-sso', role: 'user', description: 'Keycloak (SSO) linked user', confirmed: true, external: true },
  {
    key: 'user-sessions-revoked',
    role: 'user',
    description: 'User whose sessions were revoked',
    confirmed: true,
    bumpedTokenVersion: true,
  },
  {
    key: 'user-billing-day',
    role: 'user',
    description: 'User with fixed billing day',
    confirmed: true,
    billingDayOfMonth: 15,
  },
];

export interface BuildUserRowOptions {
  id: string;
  tenantId: string;
  email: string;
  state: AccountStateTemplate;
  createdAt: Date;
  random: DemoRandom;
  hasher: PasswordHasher;
  encryptor: ColumnEncryptor;
}

/** Builds a row for the identity `users` table. */
export async function buildUserRow(options: BuildUserRowOptions): Promise<SqlRow> {
  const { state, random, hasher, encryptor, createdAt } = options;
  const passwordHash = state.external ? null : await hasher.hash(DEMO_PASSWORD);
  const codeHash = await hasher.hash(DEMO_EMAIL_CODE);
  const enrolledAt = random.addDays(createdAt, random.int(1, 20));

  return {
    id: options.id,
    tenant_id: options.tenantId,
    email: options.email.toLowerCase(),
    password_hash: passwordHash,
    role: state.role,
    email_confirmed_at: state.confirmed ? random.addMinutes(createdAt, random.int(2, 90)) : null,
    locked_at: state.locked ? random.daysAgo(random.int(1, 20)) : null,
    token_version: state.bumpedTokenVersion ? random.int(2, 6) : 0,
    email_confirmation_token: state.confirmed ? null : codeHash,
    password_reset_token: state.passwordResetPending || state.passwordResetExpired ? codeHash : null,
    password_reset_token_expires_at: state.passwordResetPending
      ? random.daysFromNow(1)
      : state.passwordResetExpired
        ? random.daysAgo(2)
        : null,
    keycloak_sub: state.external ? random.id() : null,
    totp_secret: state.totp ? encryptor.encrypt(DEMO_TOTP_SECRET) : null,
    totp_enabled_at: state.totp ? enrolledAt : null,
    email_2fa_enabled_at: state.email2fa ? enrolledAt : null,
    billing_day_of_month: state.billingDayOfMonth ?? null,
    created_at: createdAt,
    updated_at: random.addDays(createdAt, random.int(0, 30)),
  };
}

/** Personal access tokens in active, expiring, expired and revoked states. */
export async function buildPersonalAccessTokenRows(
  random: DemoRandom,
  hasher: PasswordHasher,
  userId: string,
  scopes: readonly string[],
): Promise<SqlRow[]> {
  const variants = [
    { name: 'CI pipeline', expiresAt: random.daysFromNow(180), revokedAt: null, lastUsed: random.daysAgo(1) },
    { name: 'Reporting script', expiresAt: random.daysFromNow(5), revokedAt: null, lastUsed: random.daysAgo(9) },
    { name: 'Old laptop', expiresAt: random.daysAgo(14), revokedAt: null, lastUsed: random.daysAgo(40) },
    { name: 'Leaked token', expiresAt: null, revokedAt: random.daysAgo(3), lastUsed: random.daysAgo(4) },
  ];
  const rows: SqlRow[] = [];

  for (const variant of variants) {
    // The secret is discarded: demo tokens are listed in the UI but cannot authenticate.
    const secret = random.alphanumeric(40);

    rows.push({
      id: random.id(),
      user_id: userId,
      name: variant.name,
      // `fp_pat_` + 8 characters, matching PAT_LOOKUP_PREFIX_LENGTH.
      token_prefix: `fp_pat_${random.alphanumeric(8)}`,
      token_hash: await hasher.hash(secret, 4),
      scopes: json(random.pickMany(scopes, random.int(1, Math.min(3, scopes.length)))),
      expires_at: variant.expiresAt,
      revoked_at: variant.revokedAt,
      last_used_at: variant.lastUsed,
      created_at: random.daysAgo(random.int(60, 200)),
    });
  }

  return rows;
}
