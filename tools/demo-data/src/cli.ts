import { AgenstraSeeder } from './lib/agenstra/agenstra.seeder';
import { DemoCommand, DemoDataSeeder, SeederContext } from './lib/core/seeder';
import { DecabillSeeder } from './lib/decabill/decabill.seeder';

const SEEDERS: Record<string, () => DemoDataSeeder> = {
  decabill: () => new DecabillSeeder(),
  agenstra: () => new AgenstraSeeder(),
};
const DEFAULT_SEED = 20261006;
const USAGE = `Usage: demo-data <seed|reset> [decabill|agenstra|all] [options]

Commands:
  seed    Remove previously seeded demo data, then insert a fresh data set
  reset   Remove all seeded demo data (rows created by this tool only)

Options:
  --seed <number>   Random seed for reproducible data (default: ${DEFAULT_SEED})
  --dry-run         Build the SQL without touching any database
  --sql-out <dir>   Write the generated SQL scripts to <dir>
  --help            Show this help`;

export interface CliOptions {
  command: DemoCommand;
  products: string[];
  seed: number;
  dryRun: boolean;
  sqlOutDir?: string;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  let seed = DEFAULT_SEED;
  let dryRun = false;
  let sqlOutDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--seed') {
      seed = Number(argv[++i]);

      if (!Number.isInteger(seed)) {
        throw new Error('--seed expects an integer');
      }
    } else if (arg === '--sql-out') {
      sqlOutDir = argv[++i];

      if (!sqlOutDir) {
        throw new Error('--sql-out expects a directory');
      }
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const [command, product = 'all'] = positional;

  if (command !== 'seed' && command !== 'reset') {
    throw new Error(`Unknown command "${command ?? ''}"`);
  }

  if (product !== 'all' && !(product in SEEDERS)) {
    throw new Error(`Unknown product "${product}" (expected decabill, agenstra or all)`);
  }

  return {
    command,
    products: product === 'all' ? Object.keys(SEEDERS) : [product],
    seed,
    dryRun,
    sqlOutDir,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    // eslint-disable-next-line no-console
    console.log(USAGE);

    return;
  }

  const options = parseCliArgs(argv);
  const context: SeederContext = {
    workspaceRoot: process.cwd(),
    seed: options.seed,
    dryRun: options.dryRun,
    sqlOutDir: options.sqlOutDir,
    // eslint-disable-next-line no-console
    log: (message) => console.log(message),
  };

  for (const product of options.products) {
    const seeder = SEEDERS[product]();

    context.log(`\n== ${options.command} ${seeder.product} ==`);
    await seeder[options.command](context);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
