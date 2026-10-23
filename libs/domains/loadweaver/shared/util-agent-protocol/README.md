# loadweaver-shared-util-agent-protocol

This library was generated with [Nx](https://nx.dev).

## Building

Run `nx build loadweaver-shared-util-agent-protocol` to build the library.

## Running unit tests

Run `nx test loadweaver-shared-util-agent-protocol` to execute the unit tests via [Jest](https://jestjs.io).

## Protocol versioning (3.26)

The control plane must keep working with node agents one release behind (N-1), while every schema stays
`.strict()` on the agent. See `src/lib/versioning.ts`:

- `PROTOCOL_VERSION`: the protocol this build speaks. Agents send it in their hello together with `features`
  (`SUPPORTED_PROTOCOL_FEATURES`); agents built before versioning send neither and count as version 0.
- `PROTOCOL_FEATURES`: the registry of optional features (id → `since`, description, `agent`: whether the agent
  built from this source implements and advertises it). `KNOWN_PROTOCOL_FEATURES` is what the control plane
  negotiates, `SUPPORTED_PROTOCOL_FEATURES` what the agent advertises.
- `negotiate(hello)`: the version and the features both sides know; unknown features of a newer agent are ignored.
- `CONTROL_PLANE_FIELD_GATES`: control-plane → agent field path → required feature (`a.b`, `list[].c`,
  `record.*.d`). `forNode(message, negotiated)` / `envelopeForNode(envelope, negotiated)` strip every field the
  node didn't advertise; the control plane applies this to every message in the agent session's `send`.
- Release components (3.26, feature `components`, `src/lib/components.ts`): `desiredState.components` carries the
  node's target release (signed manifest, artifact route, host update step, Patroni switchover); agents report
  `components` (`componentVersions`) in the hello and every heartbeat.
- Control-plane data backups (3.20, feature `platform-backups`): `controlPlane.platformBackups` gives members the
  S3 gateway port, bucket and per-member gateway credentials (secrets only on the wire) for WAL-G in Spilo and the
  OpenSearch snapshot repository, plus a point-in-time clone of the database (`postgresClone`).
- Postgres TLS (feature `postgres-tls`): `controlPlane.postgresTls` gives members their Postgres server certificate
  and key from the cluster CA (issued at push time); older agents keep Spilo's self-signed certificate.
- Import of existing hosts (3.21, feature `node-import`, `src/lib/discovery.ts`): the join request carries a read-only
  `discovery` report with `discover: true` (the node joins `pending`, the response says `pending: true`); for a fresh
  report the control plane sends `discoveryRequest` and the agent answers `discoveryReport`. The approved join plan
  drives the node with `importStep` (channel `import:<id>`: `components`, `precopy`, `stop`, `final-sync`,
  `restart-source`, `handover`, `wipe-identity`), answered with `importProgress`. Reports are redacted on the node
  (`redactCompose`, `isSensitiveVariable`: sensitive names, URL credentials) and again by the control plane.
- Refuse gates (M7): a gate with `onMissing: 'refuse'` is not stripped — `forNode` / `envelopeForNode` throw
  `GatedFieldRefused` when the field is present for a node without the feature, and the message must not be sent.
  Used where stripping would silently change what runs: `workloads[].isolation` (`isolation-ladder`),
  `workloads[].devices` (`workload-devices`), `workloads[].microvm` (`microvm`), `workloads[].vm`
  (`virtual-machines`), `volumes[].mode` / `volumes[].initializeFrom` (`vm-block-volumes`), and the same workload
  fields under `migrationPrepare.spec`. `desiredState.host` (KVM opt-out, probe nonce) is strip-gated by
  `isolation-ladder`. The M7 messages `consoleOpen` (`vm-consoles`), `vmPower` / `vmImageImport`
  (`virtual-machines`) and `vmMigrationPrepare` / `Start` / `Switchover` (`vm-migration`) are message-gated.
- `CONTROL_PLANE_MESSAGE_GATES`: control-plane → agent message types that exist only with a feature (e.g. the
  `migration*` session messages of `live-migration`, protocol 2). `envelopeForNode` returns `null` for them on nodes
  without the feature, and the session drops them.

### Changing the protocol

- Control plane → agent: add new fields as optional, register a feature in `PROTOCOL_FEATURES` and gate the field
  in `CONTROL_PLANE_FIELD_GATES`; gate new message types in `CONTROL_PLANE_MESSAGE_GATES`. Don't add enum values, remove fields or make required fields optional.
- Agent → control plane: new fields are optional; don't remove fields or enum values N-1 agents may still send. The
  control plane decodes agent messages with `ignoreUnknownFields` (`decodeAgentMessage`): while control-plane members
  update one by one (3.26), an updated member's agent may talk to a control plane one release behind, which drops the
  fields it doesn't know instead of refusing the message. Unknown message types are still refused (the session answers
  `rejected`; the stream stays open). Agents stay strict.
- After a release has frozen version N, the first protocol change bumps `PROTOCOL_VERSION` to N + 1 (a contract
  test fails until it is bumped).

The contract tests in `src/compat/protocol-compat.spec.ts` check these rules against the latest frozen snapshot
in `src/compat/v<N>/` and validate what the control plane sends a version-0 node against it. The control-plane
integration tests do the same for the real messages.

### Release procedure: freeze the N-1 snapshot

On every release, freeze the current schemas as the snapshot the next release is checked against:

```sh
npx nx run loadweaver-shared-util-agent-protocol:freeze-protocol
```

This writes `src/compat/v<PROTOCOL_VERSION>/control-plane-to-agent.json` and `agent-to-control-plane.json`
(zod → JSON Schema draft 2020-12, the input each receiver accepts). If that version is already frozen with
different schemas, the command fails: bump `PROTOCOL_VERSION` first. Commit the snapshot with the release. Older
snapshot directories may be deleted once no supported agent speaks that version; the tests use the latest one.
