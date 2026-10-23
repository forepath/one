import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { writeFile } from 'node:fs/promises';

import { Logger } from '@nestjs/common';
import Docker from 'dockerode';
import { NestFactory } from '@nestjs/core';

import { NodeAgentModule } from '../node-agent.module';
import { AgentConnectionService } from '../stream/agent-connection.service';
import { AGENT_VERSION } from '../updates/agent-version';
import { DrRestoreService } from './dr-restore.service';
import { restoreOptionsFrom, type RestoreFlags, type RestoreOptions } from './dr-restore.utils';
import { JoinService } from './join.service';
import { CommandRunner } from '../host/command-runner';
import { DiscoveryService } from '../import/discovery.service';

const LABEL =
  /^([a-z0-9]([a-z0-9.-]*[a-z0-9])?\/)?[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?=([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)?$/;

/** `key=value` pairs from repeated `--label` flags. */
export function parseLabels(values: string[]): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const value of values) {
    if (!LABEL.test(value)) throw new Error(`invalid label ${value}`);

    const index = value.indexOf('=');

    labels[value.slice(0, index)] = value.slice(index + 1);
  }

  return labels;
}

/**
 * One-time admin claim token for `bootstrap`: from `--admin-claim-token-file` (preferred: never in the process list),
 * else `LOADWEAVER_ADMIN_CLAIM_TOKEN`; undefined when neither is set (no claim: the first registration becomes admin).
 */
export async function readAdminClaimToken(
  file: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const raw = file !== undefined ? await readFile(file, 'utf8') : env['LOADWEAVER_ADMIN_CLAIM_TOKEN'];

  if (raw === undefined) return undefined;

  const token = raw.trim();

  if (!token) throw new Error('the admin claim token is empty');

  return token;
}

/** `parseArgs` options of `bootstrap` (new cluster and `--restore`). */
export const BOOTSTRAP_OPTIONS = {
  name: { type: 'string' },
  'public-host': { type: 'string' },
  'cluster-name': { type: 'string' },
  'public-url': { type: 'string' },
  'admin-claim-token-file': { type: 'string' },
  restore: { type: 'boolean' },
  'dr-info': { type: 'string' },
  target: { type: 'string' },
  's3-endpoint': { type: 'string' },
  's3-bucket': { type: 'string' },
  's3-region': { type: 'string' },
  's3-prefix': { type: 'string' },
  'sftp-host': { type: 'string' },
  'sftp-port': { type: 'string' },
  'sftp-user': { type: 'string' },
  'sftp-path': { type: 'string' },
  'known-hosts-file': { type: 'string' },
  'sftp-key-file': { type: 'string' },
  'share-file': { type: 'string', multiple: true },
  kms: { type: 'string' },
  'target-time': { type: 'string' },
  'no-volume-restore': { type: 'boolean' },
  'keep-staging': { type: 'boolean' },
} as const;

/** Flags only `--restore` takes (a plain bootstrap refuses them, so a forgotten `--restore` can't create a cluster). */
export const RESTORE_ONLY_FLAGS = Object.keys(BOOTSTRAP_OPTIONS).filter(
  (k) => !['name', 'public-host', 'cluster-name', 'public-url', 'admin-claim-token-file', 'restore'].includes(k),
);

/**
 * Splits pasted recovery-kit shares: a JSON share document (from `{` to its closing `}`), or one bare `lws1.` share per
 * line; the text around a document (the kit's instructions) is ignored.
 */
export function splitPastedShares(text: string): string[] {
  const shares: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;

      depth++;
    } else if (text[i] === '}' && depth > 0) {
      depth--;

      if (depth === 0 && start >= 0) shares.push(text.slice(start, i + 1));
    }
  }

  const outside = text.replace(/\{[\s\S]*\}/g, '');

  for (const line of outside.split('\n')) if (/^\s*lws1\.\S+\s*$/.test(line)) shares.push(line.trim());

  return shares;
}

/** Threshold a share carries (to know when enough were typed in), or null if it can't be read. */
export function shareThreshold(share: string): number | null {
  const bare = /^lws1\.(\d{1,3})\./.exec(share.trim());

  if (bare) return Number(bare[1]);

  try {
    const doc = JSON.parse(share) as { threshold?: unknown };

    return typeof doc.threshold === 'number' ? doc.threshold : null;
  } catch {
    return null;
  }
}

/** Asks for recovery-kit shares on the terminal until the threshold the first one names is reached. */
async function promptShares(): Promise<string[]> {
  if (!process.stdin.isTTY) throw new Error('give the recovery-kit shares with --share-file (no terminal to ask on)');

  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const shares: string[] = [];

  try {
    process.stderr.write(
      'Disaster recovery needs the recovery kit of the backup key: paste each share (the JSON document or the lws1. line),\nthen an empty line.\n',
    );

    for (;;) {
      const needed = shares.length ? (shareThreshold(shares[0]) ?? 2) : null;

      if (needed !== null && shares.length >= needed) return shares;

      const lines: string[] = [];

      process.stderr.write(`Share ${shares.length + 1}${needed ? ` of ${needed}` : ''}:\n`);

      for (;;) {
        const line = await rl.question('');

        if (!line.trim() && lines.length) break;

        lines.push(line);
      }

      const pasted = splitPastedShares(lines.join('\n'));

      if (!pasted.length) process.stderr.write('That is not a recovery-kit share, try again.\n');

      shares.push(...pasted);
    }
  } finally {
    rl.close();
  }
}

/** `bootstrap --restore`: reads the files the flags name and asks for missing shares. */
async function restoreOptions(values: RestoreFlags): Promise<RestoreOptions> {
  const read = async (path: string | undefined) => (path ? await readFile(path, 'utf8') : undefined);
  const shares = (
    await Promise.all((values['share-file'] ?? []).map(async (f) => splitPastedShares(await readFile(f, 'utf8'))))
  ).flat();
  const options = restoreOptionsFrom(
    values,
    {
      drInfo: await read(values['dr-info']),
      knownHosts: await read(values['known-hosts-file']),
      sftpKey: await read(values['sftp-key-file']),
      shares,
    },
    process.env,
  );

  return { ...options, key: options.key ?? { shares: await promptShares() } };
}

/**
 * The agent's command line (`loadweaver-agent <command>`, 3.21 / 3.20): `bootstrap` (new cluster, or `--restore` for a
 * whole-cluster disaster recovery), `join`, `run`, `version`. The app's `main` passes its usage text.
 */
export async function runAgentCli(argv: string[], USAGE: string): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(USAGE);

    return;
  }

  if (command === 'version') {
    process.stdout.write(`${AGENT_VERSION}\n`);

    return;
  }

  if (command === 'discover') {
    // Read-only (3.21): no application context (nothing starts), nothing written except the optional output file.
    const { values } = parseArgs({ args: rest, options: { output: { type: 'string' } }, strict: true });
    const report = await new DiscoveryService(
      new CommandRunner(),
      new Docker({ socketPath: process.env['LOADWEAVER_DOCKER_SOCKET'] || '/var/run/docker.sock' }),
    ).discover();
    const text = `${JSON.stringify(report, null, 2)}\n`;

    if (values.output) await writeFile(values.output, text, { mode: 0o600 });
    else process.stdout.write(text);

    return;
  }

  const app = await NestFactory.createApplicationContext(NodeAgentModule, { logger: ['log', 'warn', 'error'] });

  app.enableShutdownHooks();

  switch (command) {
    case 'join': {
      const { values } = parseArgs({
        args: rest,
        options: {
          server: { type: 'string' },
          token: { type: 'string' },
          name: { type: 'string' },
          'endpoint-host': { type: 'string' },
          label: { type: 'string', multiple: true },
          'ca-cert-hash': { type: 'string' },
          discover: { type: 'boolean' },
        },
        strict: true,
      });
      const token = values.token ?? process.env['LOADWEAVER_JOIN_TOKEN'];

      if (!values.server || !token || !values.name)
        throw new Error('join needs --server, --name and a token (--token or LOADWEAVER_JOIN_TOKEN)');

      await app.get(JoinService).join({
        server: values.server,
        token,
        nodeName: values.name,
        endpointHost: values['endpoint-host'],
        labels: parseLabels(values.label ?? []),
        caCertHash: values['ca-cert-hash'],
        discover: values.discover,
      });
      await app.close();
      break;
    }
    case 'bootstrap': {
      const { values } = parseArgs({ args: rest, options: BOOTSTRAP_OPTIONS, strict: true });

      if (values.restore) {
        const options = await restoreOptions(values as RestoreFlags);
        const summary = await app.get(DrRestoreService).restore(options, (line) => process.stderr.write(`${line}\n`));

        process.stdout.write(
          [
            `Cluster ${summary.clusterId} restored on ${options.nodeName} from base backup ${summary.backup} (${summary.backupFinishedAt ?? 'time unknown'}).`,
            `Previous nodes marked lost: ${summary.previousNodes.join(', ') || 'none'}. Re-join them (or replacements) with new join tokens.`,
            'The control plane now forms the object store, re-seeds the backup repositories from the external target and restores',
            'the volumes; follow it in the console (Backups > Platform) or with GET /api/backups/platform.',
            `Timings (s): ${Object.entries(summary.timings)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ')}`,
            '',
          ].join('\n'),
        );
        await app.close();
        break;
      }

      const restoreOnly = RESTORE_ONLY_FLAGS.filter((k) => values[k as keyof typeof values] !== undefined);

      if (restoreOnly.length) throw new Error(`--${restoreOnly[0]} needs --restore`);

      if (!values.name || !values['public-host']) throw new Error('bootstrap needs --name and --public-host');

      await app.get(JoinService).bootstrap({
        nodeName: values.name,
        publicHost: values['public-host'],
        clusterName: values['cluster-name'],
        publicUrl: values['public-url'],
        adminClaimToken: await readAdminClaimToken(values['admin-claim-token-file']),
      });
      await app.close();
      break;
    }
    case 'run':
      await app.get(AgentConnectionService).start();
      Logger.log(`Loadweaver node agent ${AGENT_VERSION} running`);
      break;
    default:
      await app.close();
      throw new Error(`unknown command ${command}\n${USAGE}`);
  }
}
