import { backendMessageLabel, upperFirst } from './backend-message';

describe('backendMessageLabel', () => {
  it('translates known backend sentences', () => {
    expect(backendMessageLabel('0 of 11 nodes connected')).toBe('0 of 11 nodes connected');
    expect(backendMessageLabel('the control plane lost its quorum (1 of 3 up)')).toBe(
      'The control plane lost its quorum (1 of 3 members up)',
    );
    expect(backendMessageLabel('only PATs with fleet:on-behalf-of send fleet identities')).toContain(
      'personal access token with the fleet:on-behalf-of scope',
    );
    // API key fleet delegation (2026-10-29).
    expect(backendMessageLabel('only PATs with fleet:on-behalf-of or the cluster API key send fleet identities')).toBe(
      "The fleet's service credential can't carry fleet identities: connect with the cluster's API key or a personal access token with the fleet:on-behalf-of scope.",
    );
    expect(
      backendMessageLabel('API key fleet delegation is off on this cluster (LOADWEAVER_API_KEY_FLEET_DELEGATION)'),
    ).toContain('LOADWEAVER_API_KEY_FLEET_DELEGATION is off');
    expect(
      backendMessageLabel(
        'backups not recoverable: the recovery kit of the backup key is not confirmed (and no KMS escrow)',
      ),
    ).toMatch(/^Backups are not recoverable/);
  });

  it('translates the built-in control-plane member messages (3.39)', () => {
    expect(
      backendMessageLabel(
        'only one key holder: the built-in control-plane member holds the master key alone — add a node or a KMS, back up the recovery kit',
      ),
    ).toMatch(/^Only one key holder: .* Add a node or a KMS/);
    expect(
      backendMessageLabel(
        'the built-in control-plane member keeps a standby copy of the master key: a database dump together with the control-plane state volume can rebuild it',
      ),
    ).toContain('protect both');
    expect(
      backendMessageLabel(
        "the built-in control-plane member's seal key does not match the registered one: mount the original control-plane state volume",
      ),
    ).toMatch(/Mount the original control-plane state volume\.$/);
    expect(backendMessageLabel("the built-in control-plane member can't read its seal key")).toContain(
      'LOADWEAVER_BUILTIN_SEAL_KEY_FILE',
    );
    expect(backendMessageLabel('master key is sealed: fewer than 2 share holders answered')).toContain(
      'fewer than 2 of its key holders',
    );
  });

  it('names what needs the signed person and why the fleet can’t carry it (2026-10-29)', () => {
    expect(
      backendMessageLabel(
        'secrets through the fleet need your signed identity, but the cluster ignores it on this connection: API key fleet delegation is off on this cluster (LOADWEAVER_API_KEY_FLEET_DELEGATION)',
      ),
    ).toBe(
      "Secrets through the fleet need your signed identity, but the cluster ignores it on this connection. The cluster doesn't accept fleet identities on its API key (LOADWEAVER_API_KEY_FLEET_DELEGATION is off). Turn it on, or connect with a personal access token with the fleet:on-behalf-of scope.",
    );
    expect(
      backendMessageLabel(
        'requests on your behalf need the cluster to trust this fleet: a fleet admin establishes trust on the fleet’s cluster page',
      ),
    ).toMatch(/^Requests on your behalf need the cluster to trust this fleet\./);
    expect(
      backendMessageLabel('approvals are not relayed to this cluster: it does not verify fleet identities'),
    ).toMatch(/^Approvals don't go through the fleet/);
    expect(backendMessageLabel("Cluster eu ignores the fleet's identities on this connection")).toBe(
      "Cluster eu ignores the fleet's identities on this connection",
    );
  });

  it('translates the fleet’s unreachable / read-only items (3.43)', () => {
    expect(backendMessageLabel('Cluster eu is unreachable')).toBe('Cluster eu is unreachable');
    expect(
      backendMessageLabel(
        "Cluster eu is read-only: the cluster's database members are unreachable; it is read-only until one is back",
      ),
    ).toBe(
      "Cluster eu is read-only: changes are paused. The cluster's database members are unreachable; it stays read-only until one is back.",
    );
    expect(backendMessageLabel('Cluster eu is read-only: patroni down')).toBe(
      'Cluster eu is read-only: changes are paused. Patroni down',
    );
  });

  it('translates the takeover / fencing inbox items of the control plane (3.43, 2026-10-31)', () => {
    expect(
      backendMessageLabel(
        "the built-in control plane took over the cluster's database: no member's Postgres was primary; members that come back are fenced and re-seeded from it",
      ),
    ).toMatch(/^The built-in control plane took over the cluster's database because/);
    expect(backendMessageLabel("the cluster's database is read-only: the external copy is incomplete")).toBe(
      "The cluster's database is read-only. The external copy is incomplete",
    );
    expect(backendMessageLabel("the cluster's database members are unreachable; read-only until one is back")).toBe(
      "The cluster's database members are unreachable; read-only until one is back.",
    );
    expect(
      backendMessageLabel(
        'member n1 held data from before the takeover: moved aside to /var/lib/loadweaver/postgres.fenced-e1-x; 5 row(s) written after the takeover exported to /var/lib/loadweaver/database-diverged-x (2.0 KB) for review, not merged',
      ),
    ).toBe(
      'Member n1 held data from before the takeover. It was moved aside to /var/lib/loadweaver/postgres.fenced-e1-x; 5 rows written there after the takeover were exported to /var/lib/loadweaver/database-diverged-x (2.0 KB) for review. They are not merged.',
    );
    expect(
      backendMessageLabel(
        'member n1 held data from before the takeover: moved aside to /d and kept (no export of rows written after the takeover: the takeover time is unknown)',
      ),
    ).toMatch(/^Member n1 held data from before the takeover\. It was moved aside to \/d and kept/);
  });

  it('starts unknown messages with a capital letter and keeps empty ones', () => {
    expect(backendMessageLabel('no node fits')).toBe('No node fits');
    expect(backendMessageLabel(null)).toBe('');
    expect(upperFirst('')).toBe('');
  });
});
