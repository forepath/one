# CLI

`loadweaver` is the command line for the control plane: plan and apply YAML, follow applies live, forward a local port to a replica through a [debug tunnel](./features/terminals-files-and-tunnels.md#debug-tunnels) and enroll a [remote-access](./features/remote-access.md) device with a key generated on the device.

## Install

The CLI is a single executable that includes the Node.js runtime (about 124 MB); nothing else needs to be installed. Build it from the repository on the platform it should run on:

```bash
npx nx run loadweaver-cli:sea
install -m 0755 dist/apps/loadweaver/cli/sea/loadweaver /usr/local/bin/loadweaver
```

Without the single executable, the regular build runs with Node.js 22 or later:

```bash
npx nx build loadweaver-cli
node dist/apps/loadweaver/cli/main.js --help
```

## Logging in

```bash
# Interactive session: email, password (not echoed) and, when the account requires it, the second-factor code
loadweaver login --url https://cp.example.com --email alice@example.com

# Personal access token, from stdin or the environment (keeps it out of the shell history and process list)
printf '%s' "$PAT" | loadweaver login --url https://cp.example.com --token -
LOADWEAVER_TOKEN="$PAT" loadweaver login --url https://cp.example.com

# Personal access token as an argument
loadweaver login --url https://cp.example.com --token "$PAT"
```

- The token comes from `--token <token>`, from stdin with `--token -`, or from `LOADWEAVER_TOKEN` when neither `--token` nor `--email` is given.
- Otherwise the CLI asks for the email (unless `--email` is given) and the password (the `Password:` prompt is shown, the input isn't echoed), signs in with `POST /api/auth/login` and, if the control plane answers with the error code `LOGIN_2FA_REQUIRED`, prompts for the code and signs in again. This works with the built-in user accounts (`users` authentication); with Keycloak, use a personal access token or pass a Keycloak access token with `--token`.
- The token is checked right away with `GET /api/overview` and then stored together with the URL. Every signed-in user may read the overview (it is scoped to the caller's projects), so project members without a cluster role can log in too; a personal access token needs the `cluster:read` scope. A refused token (HTTP 401/403) fails the login and nothing is stored.
- `--url` is needed the first time only; later logins reuse the stored URL.
- An interactive session token is valid for 7 days; log in again when it expires.

**Which login for what:**

| Command                                       | Personal access token                                      | Interactive session |
| --------------------------------------------- | ---------------------------------------------------------- | ------------------- |
| `whoami`, `plan`, `apply` (without `--watch`) | yes (scopes `cluster:read`, `plans:create`, `plans:apply`) | yes                 |
| `watch`, `--watch`, `port-forward`            | no: sockets refuse personal access tokens (see below)      | yes                 |
| `vpn enroll`                                  | no: enrollment needs an interactive session                | yes                 |

With a personal access token, `watch`, `--watch` and `port-forward` stop right away, before anything is submitted, with `<command> needs an interactive login: loadweaver login --email <email>`. If a socket connection is refused (e.g. an expired session), the CLI prints `loadweaver: socket/<plans|tunnels>: <error>` and exits with code 1.

### Config file and environment

- The URL and token are stored in `$XDG_CONFIG_HOME/loadweaver/cli.json` (default `~/.config/loadweaver/cli.json`). The file is written atomically with mode `0600` (readable by the user only, also when a file is left over from an earlier run); a newly created directory gets `0700`.
- `LOADWEAVER_URL` and `LOADWEAVER_TOKEN` override the stored values, e.g. in CI:

```bash
export LOADWEAVER_URL=https://cp.example.com
export LOADWEAVER_TOKEN="$PAT"
loadweaver plan -f cluster.yaml --apply
```

Prefer `LOADWEAVER_TOKEN`, `--token -` or the interactive prompt over `--token <token>` on shared machines: arguments end up in the shell history and the process list.

## Commands

```text
loadweaver login --url <control plane> [--token <PAT>|-] [--email <email>]
loadweaver whoami                 # who you are: cluster role and project roles
loadweaver plan -f <file.yaml> [-f ...] [--apply] [--watch]
loadweaver apply <plan id> [--watch]
loadweaver watch <plan id>
loadweaver port-forward <project/deployment/service[/replica]> <[local:]remote> [--ttl <seconds>]
loadweaver vpn enroll --name <device> [--out <file>]
loadweaver vm-image push <file> [registry.lw/]<project>/<repository>[:<tag>] [--arch amd64|arm64] [--firmware uefi[,bios]] [--guest-agent] [--format qcow2|raw]
loadweaver updates status | releases | download | upload | plan | show | watch | approve | pause | resume | rollback | cancel
loadweaver version
```

Errors are printed as `loadweaver: <message>` (API errors as `HTTP <status>: <message>`) with exit code 1. Without a command the CLI prints the usage.

### whoami

```bash
$ loadweaver whoami
https://cp.example.com: cluster Production (5f0c9a3e-…)
```

### plan

Submits one or more YAML files as one plan (see [Plan and apply](./features/plan-and-apply.md)) and lists the changes:

```bash
$ loadweaver plan -f cluster.yaml -f shop.yaml
Plan 3f9e2b1c-7d4a-4c1e-9b2f-6a8d0e5c1f3a
  create  Deployment shop/site
  update  Policy shop/web-to-db
```

- `--apply` applies the plan right away; `--watch` then follows it until it settles.
- Unchanged resources aren't listed.

### apply and watch

```bash
$ loadweaver apply 3f9e2b1c-7d4a-4c1e-9b2f-6a8d0e5c1f3a --watch
3f9e2b1c  applying         12 %  node-a: tunnels
3f9e2b1c  applying         58 %  node-b: containers
3f9e2b1c  applied         100 %
```

- `apply` prints one progress line (plan id, status, percent, step); with `--watch` it follows the plan over `socket/plans` and prints a line whenever it changes, until the plan is `applied`, `failed`, `rolled-back`, `rollback-failed` or `discarded`.
- `watch <plan id>` follows a plan that is already applying (e.g. started in the console).

### port-forward

Forwards a local port to a port of a replica through debug tunnels, one per local connection:

```bash
# 127.0.0.1:5432 → port 5432 of replica 0 of shop/site/db
loadweaver port-forward shop/site/db 5432

# 127.0.0.1:15432 → port 5432 of replica 2, tunnels limited to 15 minutes
loadweaver port-forward shop/site/db/2 15432:5432 --ttl 900
psql -h 127.0.0.1 -p 15432 -U app
```

- The target is `project/deployment/service` (replica 0) or a replica id `project/deployment/service/<n>`; the ports are `remote` or `local:remote`.
- The local port listens on `127.0.0.1` only. Ctrl+C stops forwarding.
- Each connection opens its own tunnel with the TTL (default 3600 seconds, 60–28800); when it expires, the connection is closed. Tunnels need the operator or admin role in the project and are audited (see [Terminals, files and tunnels](./features/terminals-files-and-tunnels.md#debug-tunnels)).
- Refusals (role, unknown replica, too many tunnels) are printed as `tunnel: <message>` and close that connection.
- A local connection is read only once its own tunnel is open. While the connection to the control plane has a backlog, reading from the local client pauses until it is flushed; a local client that doesn't read lets at most 16 MiB pile up before its connection is closed.
- Needs an interactive login (see above).

### vpn enroll

Enrolls this machine as a [remote-access](./features/remote-access.md) device of the logged-in user:

```bash
$ loadweaver vpn enroll --name laptop
Enrolled laptop (0b7c…); WireGuard configuration written to loadweaver-laptop.conf (keep it private)
$ sudo wg-quick up ./loadweaver-laptop.conf
```

- The WireGuard key pair is generated locally. Only the public key is sent (`POST /api/vpn/devices`); the private key never leaves the machine and is written only into the configuration file.
- The file is `loadweaver-<name>.conf` in the current directory, or `--out <file>`, with mode `0600` (an existing file is overwritten and restricted to `0600` before the key is written).
- Enrollment needs an interactive session (`loadweaver login` with email and password), the same as in the console. Renewal and revocation are done in the console or the API.

### updates

```sh
loadweaver updates status                      # cluster / control-plane version, policy, nodes (agent, release, target, reboot pending)
loadweaver updates releases                    # announced and imported releases (channel, status, signed)
loadweaver updates download 3.5.0              # download + verify + import the release bundle (in the background)
loadweaver updates upload loadweaver-bundle-3.5.0.tar                       # air-gapped import (streamed)
loadweaver updates upload loadweaver-bundle-3.5.0.tar.part000 …part001       # a bundle published in parts, in order
loadweaver updates plan 3.5.0 [--host] [--os-upgrade]                        # an update plan: diff, notes, warnings, steps
loadweaver updates plan --host                 # OS / kernel updates of the current release (frozen apt snapshot)
loadweaver updates show <id> | watch <id>
loadweaver updates approve <id> [--emergency]  # --emergency: run outside maintenance windows
loadweaver updates pause <id> | resume <id> | rollback <id> | cancel <id>
```

Release bundles, update plans and the rollout are described in [Updates](./features/updates.md). Importing and every
action on update plans need the cluster-admin role (scope `cluster:admin`); `status`, `releases`, `show` and `watch` any
cluster role.

### vm-image push

Pushes a VM disk image (qcow2, raw, or a KubeVirt containerDisk archive) into the project's namespace of the built-in registry as an OCI VM image artifact for [virtual machines](./features/virtual-machines.md#images), through the control plane with your login (`registry:push` for personal access tokens). The format and virtual size come from `qemu-img info` when it is installed, else from the file's header; images with a backing file are refused. Prints the pushed reference with its digest.

```bash
loadweaver vm-image push debian-13-genericcloud-amd64.qcow2 registry.lw/shop/debian-13:20261017 --firmware uefi,bios --guest-agent
```

### version

Prints the CLI's version and, when a control plane is configured, the control plane's release (from its
`X-Loadweaver-Version` header on the public installer route). The CLI version is baked in at build time from `VERSION`
(release builds) or the repository's root `package.json`; otherwise, and in unbundled runs, it is `0.0.0-dev`.

Every API response carries the control plane's release; the CLI warns once per run (on stderr) when it is more than one
release line behind it (3.26: clients older than N-1).
