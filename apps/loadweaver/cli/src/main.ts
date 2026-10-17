#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { apply, login, plan, portForward, updates, version, vpnEnroll, watch, whoami } from './lib/commands';
import { VERSION } from './lib/version';

const USAGE = `loadweaver — the Loadweaver CLI

  loadweaver login --url <control plane> [--token <PAT>|-] [--email <email>]
  loadweaver whoami
  loadweaver plan -f <file.yaml> [-f ...] [--apply] [--watch]
  loadweaver apply <plan id> [--watch]
  loadweaver watch <plan id>
  loadweaver port-forward <project/deployment/service[/replica]> <[local:]remote> [--ttl <seconds>]
  loadweaver vpn enroll --name <device> [--out <file>]
  loadweaver updates status | releases | download <version> | upload <bundle.tar | parts…>
  loadweaver updates plan [<version>] [--host] [--os-upgrade] | show <id> | watch <id>
  loadweaver updates approve <id> [--emergency] | pause <id> | resume <id> | rollback <id> | cancel <id>
  loadweaver version

Environment: LOADWEAVER_URL, LOADWEAVER_TOKEN (override the stored login; \`login\` stores LOADWEAVER_TOKEN
when neither --token nor --email is given). \`--token -\` reads the token from stdin.`;

export { VERSION } from './lib/version';

export async function main(argv: string[], out: (line: string) => void = (l) => console.log(l)): Promise<void> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      token: { type: 'string' },
      email: { type: 'string' },
      file: { type: 'string', short: 'f', multiple: true },
      apply: { type: 'boolean' },
      watch: { type: 'boolean' },
      ttl: { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string' },
      host: { type: 'boolean' },
      'os-upgrade': { type: 'boolean' },
      emergency: { type: 'boolean' },
    },
  });

  switch (command) {
    case 'login':
      return await login({ url: values.url, token: values.token, email: values.email }, out);
    case 'whoami':
      return await whoami(out);
    case 'plan':
      return await plan({ files: values.file ?? [], apply: values.apply, watch: values.watch }, out);
    case 'apply':
      if (!positionals[0]) throw new Error('apply <plan id>');

      return await apply({ id: positionals[0], watch: values.watch }, out);
    case 'watch':
      if (!positionals[0]) throw new Error('watch <plan id>');

      return await watch({ id: positionals[0] }, out);
    case 'port-forward':
      if (positionals.length !== 2) throw new Error('port-forward <project/deployment/service> <[local:]remote>');

      return await portForward(
        { replica: positionals[0], ports: positionals[1], ...(values.ttl ? { ttl: Number(values.ttl) } : {}) },
        out,
      );
    case 'vpn':
      if (positionals[0] !== 'enroll' || !values.name) throw new Error('vpn enroll --name <device>');

      return await vpnEnroll({ name: values.name, ...(values.out ? { out: values.out } : {}) }, out);
    case 'updates':
      return await updates(
        {
          action: positionals[0],
          target: positionals[1],
          files: positionals.slice(1),
          host: values.host,
          osUpgrade: values['os-upgrade'],
          emergency: values.emergency,
        },
        out,
      );
    case 'version':
      return await version(out, VERSION);
    default:
      out(USAGE);
  }
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`loadweaver: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
