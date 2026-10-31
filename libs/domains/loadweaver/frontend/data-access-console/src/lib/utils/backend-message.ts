/**
 * Backend messages as people read them (D7, LW-13 / LW-15 / LW-19): the control plane and the fleet write short
 * English sentences in lower case ("no control-plane member can hold a master-key share yet", pins, probe reasons).
 * Known ones get a translated sentence; anything else is shown as it is, starting with a capital letter.
 */

interface KnownMessage {
  pattern: RegExp;
  label: (match: RegExpExecArray) => string;
}

const KNOWN: readonly KnownMessage[] = [
  // 3.43 (2026-10-31): the fleet's read-only items and the default reason of a read-only cluster.
  {
    pattern: /^the cluster's database members are unreachable; it is read-only until one is back$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-clusterReadOnlyReason:The cluster's database members are unreachable; it stays read-only until one is back.`,
  },
  {
    pattern: /^Cluster (.+?) is read-only: (.+)$/,
    label: (m) =>
      `${$localize`:@@lwConsoleBackend-clusterReadOnlyItem:Cluster ${m[1]}:cluster: is read-only: changes are paused.`} ${backendMessageLabel(m[2])}`,
  },
  {
    pattern: /^Cluster (\S+) is unreachable$/,
    label: (m) => $localize`:@@lwConsoleBackend-clusterUnreachableItem:Cluster ${m[1]}:cluster: is unreachable`,
  },
  {
    pattern: /^no control-plane member can hold a master-key share yet$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-masterKeyNoHolder:The cluster master key isn't set up yet: no control-plane member can hold a share of it. Join a node, or turn on the built-in control-plane member (LOADWEAVER_BUILTIN_MEMBER).`,
  },
  {
    pattern:
      /^only one key holder: the built-in control-plane member holds the master key alone — add a node or a KMS, back up the recovery kit$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-builtinSoleHolder:Only one key holder: the built-in control-plane member holds the master key alone. Add a node or a KMS, and back up the recovery kit and the control-plane state volume.`,
  },
  {
    pattern:
      /^the built-in control-plane member keeps a standby copy of the master key: a database dump together with the control-plane state volume can rebuild it$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-builtinStandby:The built-in control-plane member keeps a standby copy of the master key, so it can take over when no node is left. A database dump together with the control-plane state volume can rebuild the key: protect both.`,
  },
  {
    pattern:
      /^the built-in control-plane member's seal key does not match the registered one: mount the original control-plane state volume$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-builtinKeyMismatch:The built-in control-plane member's seal key doesn't match the registered one, so it can't open the master key. Mount the original control-plane state volume.`,
  },
  {
    pattern: /^the built-in control-plane member can't read its seal key$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-builtinKeyMissing:The built-in control-plane member can't read its seal key. Check the control-plane state volume or LOADWEAVER_BUILTIN_SEAL_KEY_FILE.`,
  },
  {
    pattern: /^master key is sealed: fewer than (\d+) share holders answered$/i,
    label: (m) =>
      $localize`:@@lwConsoleBackend-masterKeySealed:The cluster master key is sealed: fewer than ${m[1]}:threshold: of its key holders answered. Bring the control-plane members' nodes back online.`,
  },
  {
    pattern: /^backups not recoverable: the recovery kit of the backup key is not confirmed \(and no KMS escrow\)$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-pinKitUnconfirmed:Backups are not recoverable: the recovery kit of the backup key is not confirmed, and the key is not escrowed in a KMS.`,
  },
  {
    pattern: /^backups don't survive the loss of the cluster: no external backup target holds a copy$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-pinNoExternalTarget:Backups don't survive the loss of the cluster: no external backup target holds a copy.`,
  },
  {
    pattern:
      /^control-plane backups don't survive the loss of the cluster: no external backup target receives a copy of the platform backups$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-pinPlatformNoExternalTarget:Control-plane backups don't survive the loss of the cluster: no external backup target receives a copy of them.`,
  },
  {
    pattern: /^(\d+) of (\d+) nodes connected$/i,
    label: (m) => $localize`:@@lwConsoleBackend-nodesConnected:${m[1]}:connected: of ${m[2]}:total: nodes connected`,
  },
  {
    pattern: /^the control plane lost its quorum \((\d+) of (\d+) up\)$/i,
    label: (m) =>
      $localize`:@@lwConsoleBackend-quorumLost:The control plane lost its quorum (${m[1]}:up: of ${m[2]}:total: members up)`,
  },
  {
    pattern: /^only PATs with (\S+) or the cluster API key send fleet identities$/i,
    label: (m) =>
      $localize`:@@lwConsoleBackend-identityNotDelegating:The fleet's service credential can't carry fleet identities: connect with the cluster's API key or a personal access token with the ${m[1]}:scope: scope.`,
  },
  {
    pattern: /^API key fleet delegation is off on this cluster(?: \((\S+)\))?$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-identityApiKeyDelegationOff:The cluster doesn't accept fleet identities on its API key (LOADWEAVER_API_KEY_FLEET_DELEGATION is off). Turn it on, or connect with a personal access token with the fleet:on-behalf-of scope.`,
  },
  {
    pattern: /^only PATs with (\S+) send fleet identities$/i,
    label: (m) =>
      $localize`:@@lwConsoleBackend-identityNotPat:The fleet's service credential is not a personal access token with the ${m[1]}:scope: scope, so the cluster ignores the fleet's identity.`,
  },
  {
    pattern: /^fleet (\S+) is not trusted by this cluster$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-identityUntrustedFleet:The cluster doesn't trust this fleet yet. Establish trust on the fleet's cluster page.`,
  },
  {
    pattern: /^key (\S+) of fleet (\S+) is not registered$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-identityKeyUnknown:The cluster doesn't know the fleet's active key yet. Establish trust on the fleet's cluster page to register it.`,
  },
  {
    pattern: /^the fleet’s credential for this cluster may not manage trusted fleets(?::.*)?$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-trustCredentialForbidden:The fleet's credential for this cluster may not register trusted fleets (it needs a cluster admin's token with the cluster:admin scope). A cluster admin can establish trust with a one-time token instead.`,
  },
  {
    pattern: /^the one-time token (?:may not manage trusted fleets|was rejected by the cluster)(?::.*)?$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-trustTokenForbidden:The cluster refused the one-time token: it must belong to a cluster admin and carry the cluster:admin scope.`,
  },
  {
    pattern: /^the cluster answered as (\S+), but this connection belongs to (\S+)$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-trustIdentityMismatch:Another cluster answered at this connection's endpoint than the one it was set up with. Trust was not established; check the connection and re-enter its credential.`,
  },
  {
    pattern: /^the cluster no longer trusts this fleet \(removed under Trusted fleets\)$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-trustRevoked:A cluster admin removed this fleet from the cluster's trusted fleets. The fleet doesn't register itself again automatically; establish trust again if that was not intended.`,
  },
  {
    pattern: /^the cluster does not verify fleet identities \(older version\)$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-trustUnsupported:The cluster's version doesn't verify fleet identities yet. Update the cluster to work with approvals through the fleet.`,
  },
  {
    pattern: /^approvals need the cluster to trust this fleet: .*$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-approvalsNeedTrust:Approvals need the cluster to trust this fleet. A fleet admin establishes trust on the fleet's cluster page.`,
  },
  {
    pattern: /^(secrets|requests on your behalf) need the cluster to trust this fleet: .*$/i,
    label: (m) =>
      $localize`:@@lwConsoleBackend-identityNeedsTrust:${identityPurpose(m[1])}:purpose: need the cluster to trust this fleet. A fleet admin establishes trust on the fleet's cluster page.`,
  },
  {
    // "Not in effect" (2026-10-29): trust is in place, but the connection's credential can't carry identities.
    pattern:
      /^(approvals|secrets|requests on your behalf) through the fleet need your signed identity, but the cluster ignores it on this connection: (.*)$/i,
    label: (m) =>
      $localize`:@@lwConsoleBackend-identityIgnored:${identityPurpose(m[1])}:purpose: through the fleet need your signed identity, but the cluster ignores it on this connection.` +
      ` ${knownBackendMessage(m[2]) ?? upperFirst(m[2])}`,
  },
  {
    pattern:
      /^(approvals|secrets|requests on your behalf) are not relayed to this cluster: it does not verify fleet identities$/i,
    label: (m) =>
      $localize`:@@lwConsoleBackend-identityUnsupportedPurpose:${identityPurpose(m[1])}:purpose: don't go through the fleet to this cluster: its version doesn't verify fleet identities.`,
  },
  {
    pattern: /^Cluster (.+) ignores the fleet's identities on this connection$/,
    label: (m) =>
      $localize`:@@lwConsoleBackend-inboxTrustIgnored:Cluster ${m[1]}:cluster: ignores the fleet's identities on this connection`,
  },
  {
    pattern: /^Cluster (.+) doesn't trust this fleet yet$/,
    label: (m) =>
      $localize`:@@lwConsoleBackend-inboxTrustMissing:Cluster ${m[1]}:cluster: doesn't trust this fleet yet`,
  },
  {
    pattern: /^Cluster (.+) no longer trusts this fleet$/,
    label: (m) => $localize`:@@lwConsoleBackend-inboxTrustRevoked:Cluster ${m[1]}:cluster: no longer trusts this fleet`,
  },
  {
    pattern: /^Cluster (.+) doesn't know the fleet's active key$/,
    label: (m) =>
      $localize`:@@lwConsoleBackend-inboxTrustKeyMissing:Cluster ${m[1]}:cluster: doesn't know the fleet's active key`,
  },
  {
    pattern: /^Cluster (.+) answers with another cluster identity: trust was not established$/,
    label: (m) =>
      $localize`:@@lwConsoleBackend-inboxTrustMismatch:Cluster ${m[1]}:cluster: answers with another cluster identity: trust was not established`,
  },
  {
    pattern: /^not trusted$/i,
    label: () => $localize`:@@lwConsoleBackend-identityNotTrusted:The cluster doesn't trust this fleet.`,
  },
  // 3.43 takeover (2026-10-31): the control plane's own database items and read-only reasons.
  {
    pattern: /^the cluster's database members are unreachable; read-only until one is back$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-membersUnreachable:The cluster's database members are unreachable; read-only until one is back.`,
  },
  {
    pattern:
      /^the built-in control plane took over the cluster's database: no member's Postgres was primary; members that come back are fenced and re-seeded from it$/i,
    label: () =>
      $localize`:@@lwConsoleBackend-databaseTakenOver:The built-in control plane took over the cluster's database because no member's Postgres was primary. Members that come back are fenced and re-seeded from it.`,
  },
  {
    pattern: /^the cluster's database is read-only: (.+)$/i,
    label: (m) =>
      `${$localize`:@@lwConsoleBackend-databaseReadOnly:The cluster's database is read-only.`} ${backendMessageLabel(m[1])}`,
  },
  {
    pattern:
      /^member (\S+) held data from before the takeover: moved aside to (\S+); (\d+) row\(s\) written after the takeover exported to (\S+) \(([^)]+)\) for review, not merged$/,
    label: (m) =>
      $localize`:@@lwConsoleBackend-databaseFenceExported:Member ${m[1]}:node: held data from before the takeover. It was moved aside to ${m[2]}:dataDir:; ${m[3]}:rows: rows written there after the takeover were exported to ${m[4]}:exportDir: (${m[5]}:size:) for review. They are not merged.`,
  },
  {
    pattern:
      /^member (\S+) held data from before the takeover: moved aside to (\S+) and kept \(no export of rows written after the takeover(?:: (.+))?\)$/,
    label: (m) =>
      $localize`:@@lwConsoleBackend-databaseFenceKept:Member ${m[1]}:node: held data from before the takeover. It was moved aside to ${m[2]}:dataDir: and kept; the rows written there after the takeover were not exported.`,
  },
];

/** What the relay needed the signed person for, as a sentence start (`approvals` → "Approvals"). */
function identityPurpose(purpose: string): string {
  switch (purpose.toLowerCase()) {
    case 'approvals':
      return $localize`:@@lwConsoleBackend-purposeApprovals:Approvals`;
    case 'secrets':
      return $localize`:@@lwConsoleBackend-purposeSecrets:Secrets`;
    default:
      return $localize`:@@lwConsoleBackend-purposeOnBehalf:Requests on your behalf`;
  }
}

/** The first letter in upper case ("no node fits" → "No node fits"); empty stays empty. */
export function upperFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

/** A known backend message translated; `null` for any other. */
export function knownBackendMessage(message: string | null | undefined): string | null {
  const text = (message ?? '').trim();

  for (const known of KNOWN) {
    const match = known.pattern.exec(text);

    if (match) return known.label(match);
  }

  return null;
}

/** A backend message for people: a known one translated, else as it is with a capital first letter. */
export function backendMessageLabel(message: string | null | undefined): string {
  return knownBackendMessage(message) ?? upperFirst((message ?? '').trim());
}
