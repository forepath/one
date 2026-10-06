import * as path from 'path';

import { ColumnEncryptor } from '../core/encryption';
import { EnvValues, loadEnvFile } from '../core/env-file';
import { PasswordHasher } from '../core/passwords';
import { PostgresContainer, runDocker } from '../core/postgres-container';
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

import { AgenstraSeedContext } from './agenstra-context';
import { AgenstraControllerBuilder } from './agenstra-controller.builder';
import { buildManagerData, buildManagerFilterRules } from './agenstra-manager.builder';
import {
  AGENSTRA_CONTROLLER_DELETE_TARGETS,
  AGENSTRA_CONTROLLER_INSERT_ORDER,
  AGENSTRA_CONTROLLER_REQUIRED_TABLES,
  AGENSTRA_MANAGER_DELETE_TARGETS,
  AGENSTRA_MANAGER_INSERT_ORDER,
  AGENSTRA_MANAGER_REQUIRED_TABLES,
} from './agenstra.tables';

export const AGENSTRA_CONTROLLER_APP_DIR = 'apps/agenstra/backend-agent-controller';
export const AGENSTRA_MANAGER_APP_DIR = 'apps/agenstra/backend-agent-manager';

const COMPOSE_DEFAULTS: EnvValues = {
  DB_USERNAME: 'postgres',
  DB_DATABASE: 'postgres',
  PORT: '3000',
};
/** Network created by the agent-manager compose file (fixed name). */
const MANAGER_NETWORK = 'agent-manager-network';
/** Controller containers that call the agent-manager (API, queue worker, scheduler). */
const CONTROLLER_APP_CONTAINERS = ['agent-controller-api', 'agent-controller-worker', 'agent-controller-scheduler'];

export interface AgenstraSettings {
  controller: { container: string; user: string; database: string; encryptionKey?: string };
  manager: { container: string; user: string; database: string; encryptionKey?: string; apiKey: string };
  managerEndpoint: string;
  connectNetworks: boolean;
}

export function resolveAgenstraSettings(workspaceRoot: string, env: NodeJS.ProcessEnv = process.env): AgenstraSettings {
  const controllerEnv = loadEnvFile(
    path.join(workspaceRoot, AGENSTRA_CONTROLLER_APP_DIR, '.start-containers.env'),
    COMPOSE_DEFAULTS,
  );
  const managerEnv = loadEnvFile(
    path.join(workspaceRoot, AGENSTRA_MANAGER_APP_DIR, '.start-containers.env'),
    COMPOSE_DEFAULTS,
  );

  return {
    controller: {
      container: env.DEMO_DATA_AGENSTRA_CONTROLLER_POSTGRES_CONTAINER || 'agent-controller-postgres',
      user: controllerEnv.DB_USERNAME,
      database: controllerEnv.DB_DATABASE,
      encryptionKey: controllerEnv.ENCRYPTION_KEY,
    },
    manager: {
      container: env.DEMO_DATA_AGENSTRA_MANAGER_POSTGRES_CONTAINER || 'agent-manager-postgres',
      user: managerEnv.DB_USERNAME,
      database: managerEnv.DB_DATABASE,
      encryptionKey: managerEnv.ENCRYPTION_KEY,
      apiKey: managerEnv.STATIC_API_KEY ?? '',
    },
    // Container-to-container URL; reachable once the controller joins the manager network.
    managerEndpoint: env.DEMO_DATA_AGENSTRA_MANAGER_ENDPOINT || `http://agent-manager-api:${managerEnv.PORT || '3000'}`,
    connectNetworks: env.DEMO_DATA_AGENSTRA_CONNECT_NETWORK !== 'false',
  };
}

export class AgenstraSeeder implements DemoDataSeeder {
  readonly product = 'agenstra';

  async seed(context: SeederContext): Promise<void> {
    const settings = resolveAgenstraSettings(context.workspaceRoot);
    const { controller, manager } = this.connect(context, settings);

    if (!settings.manager.apiKey) {
      context.log('Warning: STATIC_API_KEY is empty for the agent-manager; workspaces will not authenticate.');
    }

    const seedContext: AgenstraSeedContext = {
      random: new DemoRandom(context.seed),
      hasher: new PasswordHasher(),
      controllerEncryptor: new ColumnEncryptor(settings.controller.encryptionKey),
      managerEncryptor: new ColumnEncryptor(settings.manager.encryptionKey),
    };
    const managerRows = new RowCollector(AGENSTRA_MANAGER_INSERT_ORDER);
    const controllerRows = new RowCollector(AGENSTRA_CONTROLLER_INSERT_ORDER);
    const agents = await buildManagerData(seedContext, managerRows);
    const managerRules = buildManagerFilterRules(seedContext, managerRows);
    const result = await new AgenstraControllerBuilder(seedContext, controllerRows, agents, managerRules, {
      managerEndpoint: settings.managerEndpoint,
      managerApiKey: settings.manager.apiKey,
      emailDomain: 'agenstra.example',
      includeGlobalOpencodeConfig: context.dryRun || this.hasNoGlobalOpencodeConfig(controller),
    }).build();
    const managerScript = new SqlScript();

    buildDemoDeletes(AGENSTRA_MANAGER_DELETE_TARGETS).forEach((statement) => managerScript.add(statement));
    managerRows.writeTo(managerScript);

    const controllerScript = new SqlScript();

    buildDemoDeletes(AGENSTRA_CONTROLLER_DELETE_TARGETS).forEach((statement) => controllerScript.add(statement));
    controllerRows.writeTo(controllerScript);

    applyScript(context, manager, managerScript, 'agenstra-manager-seed.sql');
    applyScript(context, controller, controllerScript, 'agenstra-controller-seed.sql');

    if (settings.connectNetworks && !context.dryRun) {
      this.connectControllerToManagerNetwork(context);
    }

    context.log(`Agenstra: ${managerRows.totalRows} manager rows, ${controllerRows.totalRows} controller rows`);
    context.log(
      [
        `Agenstra logins (password for all accounts: ${DEMO_PASSWORD}):`,
        ...result.loginEmails.map((email) => `  ${email}`),
      ].join('\n'),
    );
    context.log(`Agenstra TOTP secret for *-totp accounts: ${DEMO_TOTP_SECRET}`);
    context.log(`Workspaces reach the local agent-manager at ${settings.managerEndpoint}`);
  }

  async reset(context: SeederContext): Promise<void> {
    const settings = resolveAgenstraSettings(context.workspaceRoot);
    const { controller, manager } = this.connect(context, settings);
    const controllerScript = new SqlScript();
    const managerScript = new SqlScript();

    buildDemoDeletes(AGENSTRA_CONTROLLER_DELETE_TARGETS).forEach((statement) => controllerScript.add(statement));
    buildDemoDeletes(AGENSTRA_MANAGER_DELETE_TARGETS).forEach((statement) => managerScript.add(statement));
    applyScript(context, controller, controllerScript, 'agenstra-controller-reset.sql');
    applyScript(context, manager, managerScript, 'agenstra-manager-reset.sql');
  }

  private connect(
    context: SeederContext,
    settings: AgenstraSettings,
  ): { controller: PostgresContainer; manager: PostgresContainer } {
    const controller = new PostgresContainer(settings.controller);
    const manager = new PostgresContainer(settings.manager);

    if (!context.dryRun) {
      for (const [database, tables, app] of [
        [controller, AGENSTRA_CONTROLLER_REQUIRED_TABLES, 'agent-controller-api'],
        [manager, AGENSTRA_MANAGER_REQUIRED_TABLES, 'agent-manager-api'],
      ] as const) {
        database.assertRunning();
        const missing = database.findMissingTables([...tables]);

        if (missing.length > 0) {
          throw new Error(
            `Agenstra schema on ${database.label} is incomplete (missing ${missing.join(', ')}). ` +
              `Wait until ${app} has started and run its migrations.`,
          );
        }
      }
    }

    return { controller, manager };
  }

  private hasNoGlobalOpencodeConfig(controller: PostgresContainer): boolean {
    // The global OpenCode config is a singleton; never add a second row next to a real one.
    const [[count] = ['0']] = controller.query(
      `SELECT count(*) FROM global_opencode_config WHERE id::text NOT LIKE '5eedda7a-%'`,
    );

    return count === '0';
  }

  /**
   * The controller and manager compose projects use separate bridge networks. Joining the
   * controller containers to the manager network lets workspaces reach `agent-manager-api`.
   * `start-containers` recreates containers, so this has to run again after each restart.
   */
  private connectControllerToManagerNetwork(context: SeederContext): void {
    for (const container of CONTROLLER_APP_CONTAINERS) {
      const result = runDocker(['network', 'connect', MANAGER_NETWORK, container]);
      const output = `${result.stdout}${result.stderr}`;

      if (result.status === 0) {
        context.log(`Connected ${container} to ${MANAGER_NETWORK}`);
      } else if (/already exists/i.test(output)) {
        context.log(`${container} is already connected to ${MANAGER_NETWORK}`);
      } else {
        context.log(`Warning: could not connect ${container} to ${MANAGER_NETWORK}: ${output.trim()}`);
      }
    }
  }
}
