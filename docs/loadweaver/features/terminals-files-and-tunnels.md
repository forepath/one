# Terminals, Files and Tunnels

Operators work directly in running replicas: a terminal in a container (or, if the cluster allows it, a root shell on a node), a file browser over a replica's filesystem or a volume, and debug tunnels from a local port to a replica's port. The browser and the [CLI](../cli.md) only ever talk to the control plane; the control plane reaches the node over the node's own outbound stream, so all of this also works for nodes behind NAT and needs no inbound port on any node.

## How it runs

- Each terminal, file request and tunnel gets its own channel on the node's stream (`execOpen` / `execInput` / `execResize` / `execClose` → `execOutput` / `execExit`, `fileRequest` → `fileResponse`, `tunnelOpen` / `tunnelData` / `tunnelClose` both ways). Data travels base64-encoded in chunks of at most 256 KiB.
- The control plane checks access first; the node then acts only within its own workloads and volumes (and its host, if node shells are enabled).
- With several control-plane replicas, the browser's replica may not be the one holding the node's stream. The replica holding it is recorded on the node at hello (`lw_nodes.stream_owner`), and messages are relayed between the two through Postgres `LISTEN` / `NOTIFY` on the channel `lw_live`. Messages over 7 KB go through the table `lw_live_relay` (deleted when read, swept after a minute). Every replica therefore serves every session.
- A node whose stream is gone answers nothing: terminals close with an error, file requests fail with `504` after 30 seconds, tunnels close with `node not connected`.

## Who may

| What                                   | Who                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Terminal and files in a replica        | Project operators and admins; developers only when the project's `developerExec` is on; viewers never |
| Files in a volume                      | The same as for the volume's project                                                                  |
| Debug tunnel to a replica              | Project operators and admins                                                                          |
| Machine exec in a replica              | Project operators and admins                                                                          |
| Node shell (root on the host)          | Cluster admins, and only while the `Cluster` enables `nodeShellEnabled`                               |
| Terminal session list and recordings   | Auditors and cluster admins (all), project admins (their projects)                                    |
| Open tunnels (`GET /api/live/tunnels`) | Whoever may read the tunnel's project                                                                 |

Unknown targets and targets in projects the caller can't read answer "not found"; readable targets without the needed role answer "forbidden". Project roles and `developerExec` are described in [Projects and access](./projects-and-access.md).

**Authentication:** the file API and the session / tunnel lists accept personal access tokens (scope `live:access` for files, `audit:read` for sessions and recordings, `projects:read` for tunnels). The `socket/terminals` and `socket/tunnels` namespaces, like every Loadweaver socket, accept interactive sessions only (console login, Keycloak, or `loadweaver login` with email and password); personal access tokens are refused with `Unauthorized`. The one exception is [machine exec](#machine-exec): `socket/exec` accepts personal access tokens with the scope `live:exec`.

## Terminals

Namespace `socket/terminals` (env `LOADWEAVER_TERMINALS_WEBSOCKET_NAMESPACE`), with Agenstra's events:

| Event             | Direction       | Payload                                                                               |
| ----------------- | --------------- | ------------------------------------------------------------------------------------- |
| `createTerminal`  | client → server | `{ sessionId?, target: { replica } \| { node }, shell?, cols = 80, rows = 24 }`       |
| `terminalCreated` | server → client | `{ sessionId, recorded }`: show a banner while `recorded` is true                     |
| `terminalInput`   | client → server | `{ sessionId, data }`: UTF-8 text, at most 64 KiB characters per event                |
| `terminalResize`  | client → server | `{ sessionId, cols, rows }` (1–1000)                                                  |
| `terminalOutput`  | server → client | `{ sessionId, data }`: UTF-8 text                                                     |
| `closeTerminal`   | client → server | `{ sessionId }`                                                                       |
| `terminalClosed`  | server → client | `{ sessionId, exitCode, error? }`                                                     |
| `error`           | server → client | `{ sessionId?, message }`: invalid payload, not allowed, unknown session, too many, … |

```javascript
const socket = io('https://cp.example.com/socket/terminals', {
  transports: ['websocket'],
  auth: { Authorization: `Bearer ${sessionToken}` },
});

socket.emit('createTerminal', { sessionId: 't1', target: { replica: 'shop/site/web/0' }, cols: 120, rows: 32 });
socket.on('terminalOutput', ({ sessionId, data }) => term.write(data));
term.onData((data) => socket.emit('terminalInput', { sessionId: 't1', data }));
```

- A replica terminal is a `docker exec` with a TTY in the running container: by default `bash -l` if the image has bash, otherwise `sh -l`. `shell` (an absolute path such as `/bin/ash`) starts something else. No tools are needed in the image beyond a shell.
- `target.replica` is `project/deployment/service/index`; `target.node` is a node name.
- Output is batched on the node (every 20 ms or at 32 KiB) so a busy terminal doesn't flood the stream.
- Limits: 10 sessions per socket, 32 sessions per node, 30 minutes without input or output closes a session (`idle`). Sessions belong to their socket: a disconnect closes them. A node that doesn't confirm a close within 5 seconds doesn't keep the session open.
- Every session is listed in `lw_terminal_sessions` (user, project, target, node, recorded, exit code, start, end) and audited as `terminal.open` and `terminal.close` (with exit code and duration in seconds).

### Node shell

A root shell on the node's host, for cluster admins only, and off unless the cluster enables it:

```yaml
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: cluster }
spec:
  nodeShellEnabled: true # default false
```

- The setting reaches the nodes with their desired state (`liveAccess.nodeShell`); the node refuses a node shell on its own while it's off, so both the control plane and the node check it. A node that hasn't received a desired state since its agent started refuses too.
- The node starts a short-lived **privileged helper container** (`alpine:3.22`, pinned by digest, label `loadweaver.com/node-shell`) with the host's PID and network namespaces, which runs `nsenter -t 1 -m -u -i -n -p` into the host and starts the shell there. The helper is removed when the shell ends. Its image is pulled on demand the first time.
- Node shells are **always recorded**.
- Turning `nodeShellEnabled` off stops new node shells; shells already open stay open until they end.

### Recording

Sessions are recorded as [asciicast v2](https://docs.asciinema.org/manual/asciicast/v2/) (`.cast`, playable with `asciinema play`):

| Session          | Recorded when                                                               |
| ---------------- | --------------------------------------------------------------------------- |
| Node shell       | always                                                                      |
| Replica terminal | the `Cluster`'s `terminalRecording: on`, or the project's `recordTerminals` |

```yaml
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: cluster }
spec:
  terminalRecording: on # off (default): only projects with recordTerminals
  terminalRecordingRetentionDays: 90 # 1–3650, default 90
```

- A recording holds the terminal's **output** (what the user saw, including echoed input) and its resizes. Keystrokes that the terminal doesn't echo, such as typed passwords, are not in it.
- The recording is kept in the control plane's memory while the session runs and is stored when the session ends: at most 50 MB of output per session, after which the cast notes `[recording truncated]`. A session cut off by a control-plane restart has no recording.
- Recordings are stored in the control plane's file storage (the object store bucket `lw-files` by default, see [Periodic reports](./periodic-reports.md#storage)) under `loadweaver/recordings/<year>/<month>/<session id>.cast`.
- Every hour, one control-plane replica deletes recordings of sessions that started more than `terminalRecordingRetentionDays` ago. The session record itself stays.

### Session list and recordings

```bash
# Latest sessions (at most 1000), optionally of one project
curl -s "https://cp.example.com/api/live/sessions?project=shop" -H "Authorization: Bearer $TOKEN"

# A recording
curl -s -o session.cast "https://cp.example.com/api/live/sessions/$SESSION_ID/recording" \
  -H "Authorization: Bearer $TOKEN"
asciinema play session.cast
```

```json
[
  {
    "id": "2a4c1d0e-5b7f-4e2a-9c3d-8f1e6a0b2c4d",
    "userId": "6c1f3e1a-2b9d-4c55-9a43-0f6d2e8b7a10",
    "project": "shop",
    "target": "replica/shop/site/web/0",
    "node": "node-a",
    "recorded": true,
    "hasRecording": true,
    "exitCode": 0,
    "startedAt": "2026-10-18T09:12:03.000Z",
    "endedAt": "2026-10-18T09:20:41.000Z"
  }
]
```

Node shells have `project: null` and the target `node/<name>`.

## Machine exec

Non-interactive commands in a replica for machines, for example Agenstra's agent manager running its environments on Loadweaver ([guide](../guides/agenstra-on-loadweaver.md)). Namespace `socket/exec` (env `LOADWEAVER_EXEC_WEBSOCKET_NAMESPACE`):

| Event     | Direction       | Payload                                                                                   |
| --------- | --------------- | ----------------------------------------------------------------------------------------- |
| `exec`    | client → server | `{ execId, replica, command: string[], user?, workingDir?, env?: ["NAME=value"] }`        |
| `started` | server → client | `{ execId }`                                                                              |
| `stdin`   | client → server | `{ execId, data?: binary, eof?: true }`: `eof` closes the program's stdin after `data`    |
| `stdout`  | server → client | `{ execId, data: binary }`                                                                |
| `stderr`  | server → client | `{ execId, data: binary }`                                                                |
| `kill`    | client → server | `{ execId }`                                                                              |
| `exit`    | server → client | `{ execId, exitCode, error? }`: `exitCode` is `null` when the session failed or was ended |
| `error`   | server → client | `{ execId?, message }`                                                                    |

- **No TTY**: stdout and stderr arrive apart and binary-safe (Socket.IO binary frames end to end; on the node's stream base64 chunks of at most 256 KiB). There is no resize. `user` is a name, `uid` or `uid:gid`.
- **Credentials**: personal access tokens with `live:exec` (users and Keycloak mode, validated like API requests, so revocation, expiry and demotion apply at once), interactive sessions, or the static API key. A PAT without `live:exec` is refused at the handshake. The connection's token is validated again before every `exec` and every minute while sessions run; a revoked, expired or rescoped token (or a PAT that lost `live:exec`) ends the connection's sessions and disconnects it, and a connection never outlives its token's expiry (`exp` of a JWT).
- **Who**: operators and admins of the replica's project only (developers never, whatever `developerExec` says). Access is checked again every minute; a removed role ends running sessions.
- **Limits**: 20 new sessions per second per user (bursts of 200), 128 open sessions per connection and 256 per user, stdin 8 MiB/s per session (bursts of 32 MiB), 24 hours per session. A client that doesn't read its output fast enough ends the session.
- **Audit**: every session is one `exec.run` entry with node, program (the first argument's base name: arguments may carry secrets), exit code, duration and the bytes of stdin / stdout / stderr. Machine exec isn't recorded and isn't in the terminal session list.
- **Nodes** need an agent that advertises the protocol feature `exec-stdio` (`execOpen.tty: false` with `user`, `workingDir`, `env`, `execInput.eof`, `execOutput.stream`); others are refused with an error. Commands run with `docker exec` without a TTY, also in gVisor replicas; in a replica restored by live migration through `runc exec` / `runsc exec` with a 0600 process spec file (command, environment, working directory and user never appear on a command line; `user` must be numeric, `uid` or `uid:gid`, there).

```js
import { io } from 'socket.io-client';

const exec = io('https://<control-plane>/socket/exec', {
  transports: ['websocket'],
  auth: { Authorization: `Bearer ${machineSessionFromPat}` }, // POST /api/auth/token with the PAT
});

exec.emit('exec', { execId: 'e1', replica: 'shop/api/web/0', command: ['sha256sum'] });
exec.on('started', () => exec.emit('stdin', { execId: 'e1', data: Buffer.from('hello'), eof: true }));
exec.on('stdout', ({ data }) => process.stdout.write(data));
exec.on('exit', ({ exitCode }) => console.log('exit', exitCode));
```

## Files

Agenstra's file API under `/api/live/files`. Every call names a target:

- `target=replica:<project/deployment/service/index>` — the replica's container filesystem;
- `target=volume:<project/deployment/volume>` — a volume, on the node holding its primary replica.

and a `path` (absolute inside the target, default `/`, at most 4096 characters, no control characters).

| Call                       | What                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /live/files`          | List a directory (folders first, at most 10,000 entries)                                      |
| `HEAD /live/files/content` | Size and type of a file (`Content-Length`, `X-File-Type`, `Accept-Ranges: bytes`)             |
| `GET /live/files/content`  | Read a file, whole (up to 100 MB) or a `Range`                                                |
| `PUT /live/files/content`  | Write a file: whole (up to 10 MB) or in sequential chunks with `Content-Range` (up to 100 MB) |
| `POST /live/files`         | Create an empty file or a directory: `{ "type": "file" \| "directory" }`                      |
| `DELETE /live/files`       | Delete a file or a directory (recursively)                                                    |
| `PATCH /live/files`        | Move / rename: `{ "destination": "/new/path", "overwrite": false }`                           |
| `POST /live/files/copy`    | Copy (recursively): `{ "destination": "/new/path", "overwrite": false }`                      |

```bash
T='target=replica:shop/site/web/0'

# List /etc/nginx
curl -s "https://cp.example.com/api/live/files?$T&path=/etc/nginx" -H "Authorization: Bearer $TOKEN"

# Read the first KiB of a log (206 with Content-Range)
curl -s "https://cp.example.com/api/live/files/content?$T&path=/var/log/app.log" \
  -H "Authorization: Bearer $TOKEN" -H 'Range: bytes=0-1023'

# The last 4 KiB
curl -s "https://cp.example.com/api/live/files/content?$T&path=/var/log/app.log" \
  -H "Authorization: Bearer $TOKEN" -H 'Range: bytes=-4096'

# Download as an attachment
curl -s -OJ "https://cp.example.com/api/live/files/content?$T&path=/etc/nginx/nginx.conf&download=true" \
  -H "Authorization: Bearer $TOKEN"

# Write a small file (≤ 10 MB in one request)
curl -s -X PUT "https://cp.example.com/api/live/files/content?$T&path=/tmp/debug.conf" \
  -H "Authorization: Bearer $TOKEN" --data-binary @debug.conf -i

# Create a directory, move, copy, delete
curl -s -X POST "https://cp.example.com/api/live/files?$T&path=/tmp/dump" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"type":"directory"}'
curl -s -X PATCH "https://cp.example.com/api/live/files?$T&path=/tmp/debug.conf" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"destination":"/tmp/dump/debug.conf"}'
curl -s -X POST "https://cp.example.com/api/live/files/copy?$T&path=/tmp/dump" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"destination":"/tmp/dump2","overwrite":true}'
curl -s -X DELETE "https://cp.example.com/api/live/files?$T&path=/tmp/dump2" -H "Authorization: Bearer $TOKEN"
```

### Reads

- `Range: bytes=start-end`, `bytes=start-` and `bytes=-suffix` answer `206` with `Content-Range: bytes start-end/size`. A range outside the file answers `416` with `Content-Range: bytes */size`.
- Without a range, files over 100 MB answer `413`; read them in ranges. A single range is limited to 100 MB as well.
- Content is always `application/octet-stream` with `X-Content-Type-Options: nosniff`, so nothing renders in the console's origin. `X-File-Type` (`text`, `image`, `video`, `audio`, `pdf`, `binary`, from the extension; files without an extension count as `text`) tells the browser which preview to use. `download=true` adds `Content-Disposition: attachment`.
- Reading a directory answers `400`.

### Chunked uploads

Files over 10 MB are uploaded in sequential chunks (each at most 10 MB) with `Content-Range` and an `X-Upload-Id` (`[A-Za-z0-9_-]{1,64}`) that ties them together:

```bash
SIZE=$(stat -c %s dump.sql); CHUNK=$((8 * 1024 * 1024)); ID=$(uuidgen | tr -d -)

for ((start = 0; start < SIZE; start += CHUNK)); do
  end=$((start + CHUNK - 1)); ((end >= SIZE)) && end=$((SIZE - 1))
  tail -c +$((start + 1)) dump.sql | head -c $((end - start + 1)) |
    curl -s -X PUT "https://cp.example.com/api/live/files/content?target=volume:shop/site/data&path=/dump.sql" \
      -H "Authorization: Bearer $TOKEN" -H "X-Upload-Id: $ID" \
      -H "Content-Range: bytes $start-$end/$SIZE" --data-binary @- -o /dev/null -w '%{http_code}\n'
done
```

- Chunks must come in order: each one starts where the previous one ended (otherwise `400 expected start <n>`). The first chunk (`start` 0) creates or truncates the file. A missing upload id counts as `default`.
- Every chunk but the last answers `202`; the last one answers `204`. The total is at most 100 MB.
- An upload unfinished for 30 minutes is forgotten: the next chunk must start at 0 again. The partial file stays as written.
- The upload state is kept by the control-plane replica that received the chunks; with several replicas behind a load balancer, send all chunks of one upload to the same replica (sticky sessions).

### Container filesystem or volume

| Target    | What you see                                                                                                 | Writes                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `replica` | The container's merged root filesystem (image + container layer), read on the node; the image needs no tools | **Lost on restart, re-creation or migration** of the replica |
| `volume`  | The volume's mounted filesystem on the node holding its primary replica                                      | Persistent and replicated like every write to the volume     |

- Every write (`write` once complete, `create`, `delete`, `move`, `copy`) is audited as `files.<action>` with the target and path.
- Writes into a container filesystem answer with the header `X-Loadweaver-Warning: Changes in a container filesystem are lost on restart or migration` and are recorded as a `drift` event (see [Metrics](./metrics.md#events)). Use a volume for anything that must stay.
- The replica view shows the container's own root filesystem only: volumes, bind mounts and tmpfs mounted **inside** the container are not part of it, and a write to such a path lands underneath the mount, invisible to the replica. Browse the volume itself (`target=volume:…`) instead.
- Files and directories are written by the agent as root (`0644` / `0755`). A replica running as another user may need to `chown` them.
- Volumes are only reachable **while mounted on their primary node**, that is while their workload runs there. A stopped workload or a volume between placements answers `the volume is not mounted on this node`.
- Sandboxed replicas (gVisor) keep their own root-filesystem overlay inside the sandbox: the file browser may show the image's files without what the replica wrote at runtime, and changes made through it may not reach the running replica. Use a terminal or a volume there. Replicas whose runtime exposes no merged filesystem on the host at all answer `this container runtime has no browsable filesystem`.
- [MicroVM](./isolation-levels.md#microvms) replicas show the **guest's** root: the image layers plus the replica's writable layer the guest boots from, so files the workload wrote are visible and writes reach it. Terminals and machine exec in microVM replicas run inside the guest through the `vm-exec` bridge (same events, roles, recordings, TTY resize and exit codes).

### Confinement

All file operations stay inside the target's root:

- `..` can't leave the root, and the parent directory of every path is resolved through symbolic links and must stay inside the root.
- For reads and listings a symbolic link at the end of the path is followed only if it leads to a place inside the root (`403 link leads outside the root` otherwise). Absolute links are resolved against the host, not the container, so links like `/etc/alternatives/…` inside an image usually point outside and are refused. The same applies to directories on the way: a path through an absolutely linked directory (e.g. `/var/run` → `/run`) is refused.
- Writes, deletes, moves and copies act on the link itself and never follow it: a write to a link fails, deleting a link removes the link, recursive deletes never descend through links, copies copy links as links.
- The root itself can't be deleted; a directory can't be moved or copied into itself.

Node errors map to HTTP: `not-found` → `404`, `exists` → `409`, `denied` → `403`, `too-large` → `413`, everything else → `400`; a node that doesn't answer within 30 seconds → `504`.

## VM consoles

[Virtual machines](./virtual-machines.md#consoles) have no container to open a terminal in; they get a **serial console** (the guest's serial line in the terminal panel, boot log first) and a **graphical console** (VNC through noVNC) instead, over the Socket.IO namespace `socket/consoles`. They use the same live path as terminals: the control plane relays over the node's agent stream, the same roles apply (operators and admins, developers with `developerExec`), sessions are audited (`vm.console.open` / `vm.console.close`) and appear in the session list with the target `virtual-machine/<project>/<name>/console/<serial|vnc>`. Serial consoles are recorded like terminals; VNC sessions record metadata and duration only. Idle consoles close after 30 minutes.

## Debug tunnels

A debug tunnel is a TCP connection from the node to one port of a replica, bridged through the control plane to a client. `loadweaver port-forward` (see the [CLI](../cli.md#port-forward)) opens one tunnel per local connection.

Namespace `socket/tunnels` (env `LOADWEAVER_TUNNELS_WEBSOCKET_NAMESPACE`):

| Event          | Direction       | Payload                                                                                |
| -------------- | --------------- | -------------------------------------------------------------------------------------- |
| `openTunnel`   | client → server | `{ tunnelId, replica, port, ttlSeconds = 3600 }` (`ttlSeconds` 60–28800)               |
| `tunnelOpened` | server → client | `{ tunnelId, expiresAt }`                                                              |
| `tunnelData`   | both            | `{ tunnelId, data }`: base64 bytes                                                     |
| `closeTunnel`  | client → server | `{ tunnelId }`                                                                         |
| `tunnelClosed` | server → client | `{ tunnelId, reason }`: `closed`, `expired`, `disconnected`, or the node's reason      |
| `tunnelError`  | server → client | `{ tunnelId?, message }`: invalid payload, not allowed, too many tunnels, duplicate id |

- **Time-limited:** a tunnel closes after its TTL (default 1 hour, at most 8 hours), when the client closes it or disconnects, or when the replica closes the connection. At most 16 tunnels per socket.
- **No policy change:** the tunnel doesn't change any policy. For its lifetime the agent adds a temporary operator allowance in its own nftables table `inet lw_live`: one rule in an `output` chain (priority -10) that marks the agent's own packets (uid 0) to exactly the replica's address and port with mark `0x4c570001`, commented `tunnel:<channel>`. The `output` chain of the `inet loadweaver` table accepts that mark (`builtin:operator-tunnel`) before the policy rules. The rule is deleted when the tunnel's connection closes. The `lw_live` table is separate because the `loadweaver` table is replaced on every apply.
- The tunnel connects to the replica's address on the workload network; it reaches whatever listens on that port in the replica.
- Every tunnel is recorded in `lw_tunnels` and audited as `tunnel.open` (port, expiry) and `tunnel.close` (reason).
- `GET /api/live/tunnels` lists the open, unexpired tunnels the caller may see; the topology map shows them as temporary operator edges:

```json
[
  {
    "id": "8d2f…",
    "userId": "6c1f3e1a-…",
    "project": "shop",
    "replica": "shop/site/db/0",
    "node": "node-b",
    "port": 5432,
    "openedAt": "2026-10-18T10:00:00.000Z",
    "expiresAt": "2026-10-18T11:00:00.000Z"
  }
]
```

## Audit

| Action                                                                    | When                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `terminal.open`, `terminal.close`                                         | A terminal session starts / ends (exit code, duration) |
| `files.write`, `files.create`, `files.delete`, `files.move`, `files.copy` | A file write completes                                 |
| `tunnel.open`, `tunnel.close`                                             | A debug tunnel opens / closes (port, expiry, reason)   |

Refused requests, listings, file reads and recording downloads are not audited.

## Not there yet

- A terminal or tunnel lives on the control-plane replica its client is connected to; if that replica restarts, the client must reconnect and the session's recording is lost.
- Access is checked when a session or tunnel opens; a role removed later doesn't end it (the idle timeout or TTL does).
- The file browser has no search and no archive download of folders.
