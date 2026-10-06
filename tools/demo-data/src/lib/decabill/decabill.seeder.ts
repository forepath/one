import * as path from 'path';

import { ColumnEncryptor } from '../core/encryption';
import { EnvValues, loadEnvFile, readBooleanEnv, readListEnv } from '../core/env-file';
import { PasswordHasher } from '../core/passwords';
import { PostgresContainer } from '../core/postgres-container';
import { DemoRandom } from '../core/random';
import { RowCollector } from '../core/row-collector';
import {
  applyScript,
  buildDemoDeletes,
  DemoDataSeeder,
  DEMO_PASSWORD,
  DEMO_TOTP_SECRET,
  SeederContext,
} from '../core/seeder';
import { SqlScript } from '../core/sql';

import { buildDatevAndOss, buildGlobalSnapshots, buildNotifications, buildSuppliers } from './decabill-backoffice';
import { buildCatalog } from './decabill-catalog';
import { DecabillCommerceBuilder } from './decabill-commerce';
import { DECABILL_NUMBER_FUNCTIONS_SQL, DecabillTenantContext } from './decabill-context';
import { buildUsers } from './decabill-customers';
import {
  DECABILL_DELETE_TARGETS,
  DECABILL_INSERT_ORDER,
  DECABILL_REQUIRED_TABLES,
  DECABILL_SKIP_ON_CONFLICT,
} from './decabill.tables';

export const DECABILL_APP_DIR = 'apps/decabill/backend-billing-manager';

/** Tables with sequence-allocated numbers and the date their numbers should follow. */
const DECABILL_NUMBERED_TABLES: [string, string][] = [
  ['billing_customer_profiles', 'created_at'],
  ['billing_subscriptions', 'created_at'],
  ['billing_offers', 'created_at'],
  ['billing_invoices', 'issued_at'],
  ['billing_supplier_profiles', 'created_at'],
  ['billing_supplier_invoices', 'issued_at'],
];
/** Values from docker-compose.yaml used when `.start-containers.env` leaves them empty. */
const COMPOSE_DEFAULTS: EnvValues = {
  DB_USERNAME: 'postgres',
  DB_DATABASE: 'postgres',
  TENANTS_ALLOW_DEFAULT: 'true',
  TENANTS_SHARED_NUMBERS: 'true',
  BILLING_ISSUER_COUNTRY: 'DE',
};

export interface DecabillSettings {
  container: string;
  user: string;
  database: string;
  tenants: string[];
  sharedNumbers: boolean;
  issuerCountry: string;
  encryptionKey: string | undefined;
}

export function resolveDecabillSettings(workspaceRoot: string, env: NodeJS.ProcessEnv = process.env): DecabillSettings {
  const appEnv = loadEnvFile(path.join(workspaceRoot, DECABILL_APP_DIR, '.start-containers.env'), COMPOSE_DEFAULTS);
  const tenants = readListEnv(appEnv, 'TENANTS');

  if (readBooleanEnv(appEnv, 'TENANTS_ALLOW_DEFAULT', true) && !tenants.includes('default')) {
    tenants.unshift('default');
  }

  return {
    container: env.DEMO_DATA_DECABILL_POSTGRES_CONTAINER || 'billing-manager-postgres',
    // The compose postgres service always creates the `postgres` superuser; DB_DATABASE selects the app database.
    user: appEnv.DB_USERNAME,
    database: appEnv.DB_DATABASE,
    tenants: tenants.length > 0 ? tenants : ['default'],
    sharedNumbers: readBooleanEnv(appEnv, 'TENANTS_SHARED_NUMBERS', true),
    issuerCountry: appEnv.BILLING_ISSUER_COUNTRY || 'DE',
    encryptionKey: appEnv.ENCRYPTION_KEY,
  };
}

export class DecabillSeeder implements DemoDataSeeder {
  readonly product = 'decabill';

  async seed(context: SeederContext): Promise<void> {
    const settings = resolveDecabillSettings(context.workspaceRoot);
    const database = this.connect(context, settings);
    const random = new DemoRandom(context.seed);
    const rows = new RowCollector(DECABILL_INSERT_ORDER);
    const encryptor = new ColumnEncryptor(settings.encryptionKey);
    const hasher = new PasswordHasher();
    const datevCounters = { debtor: 1, creditor: 1 };
    const loginSummary: string[] = [];

    context.log(`Decabill: building demo data for tenants ${settings.tenants.join(', ')}`);

    for (const [index, tenantId] of settings.tenants.entries()) {
      const tenantContext: DecabillTenantContext = {
        tenantId,
        numberScope: settings.sharedNumbers ? '__shared__' : tenantId,
        issuerCountry: settings.issuerCountry,
        emailDomain: `${tenantId}.decabill.example`,
        random,
        rows,
        encryptor,
        hasher,
        datevCounters,
      };
      const users = await buildUsers(tenantContext);
      const catalog = buildCatalog(tenantContext);

      new DecabillCommerceBuilder(tenantContext, catalog, users.admins).build(users.customers);
      buildSuppliers(tenantContext);
      buildDatevAndOss(tenantContext);
      buildNotifications(
        tenantContext,
        users.customers.map((customer) => customer.email),
      );

      if (index === 0) {
        buildGlobalSnapshots(tenantContext);
      }

      loginSummary.push(`  ${tenantId}: admin@${tenantContext.emailDomain} (X-Tenant: ${tenantId})`);
    }

    for (const [table, column] of DECABILL_NUMBERED_TABLES) {
      rows.sortByDate(table, column);
    }

    const script = new SqlScript();

    script.comment('Remove previously seeded demo rows');
    buildDemoDeletes(DECABILL_DELETE_TARGETS).forEach((statement) => script.add(statement));
    script.comment('Number allocation helpers (session-local)');
    script.add(DECABILL_NUMBER_FUNCTIONS_SQL);
    rows.writeTo(script, (table) => (DECABILL_SKIP_ON_CONFLICT.has(table) ? 'ON CONFLICT DO NOTHING' : undefined));

    applyScript(context, database, script, 'decabill-seed.sql');
    context.log(`Decabill: ${rows.totalRows} rows across ${settings.tenants.length} tenants`);
    context.log([`Decabill logins (password for all accounts: ${DEMO_PASSWORD}):`, ...loginSummary].join('\n'));
    context.log(`Decabill TOTP secret for *-totp accounts: ${DEMO_TOTP_SECRET}`);
  }

  async reset(context: SeederContext): Promise<void> {
    const settings = resolveDecabillSettings(context.workspaceRoot);
    const database = this.connect(context, settings);
    const script = new SqlScript();

    buildDemoDeletes(DECABILL_DELETE_TARGETS).forEach((statement) => script.add(statement));
    applyScript(context, database, script, 'decabill-reset.sql');
  }

  private connect(context: SeederContext, settings: DecabillSettings): PostgresContainer {
    const database = new PostgresContainer({
      container: settings.container,
      user: settings.user,
      database: settings.database,
    });

    if (!context.dryRun) {
      database.assertRunning();
      const missing = database.findMissingTables(DECABILL_REQUIRED_TABLES);

      if (missing.length > 0) {
        throw new Error(
          `Decabill schema is incomplete (missing ${missing.join(', ')}). ` +
            'Wait until billing-manager-api has started and run its migrations.',
        );
      }
    }

    return database;
  }
}
