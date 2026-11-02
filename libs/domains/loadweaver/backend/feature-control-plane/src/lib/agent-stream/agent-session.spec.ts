import {
  controlPlaneMessage,
  decodeControlPlaneMessage,
  negotiate,
  type DesiredState,
  type Envelope,
  type FieldGates,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { createAgentSession } from './agent-stream.server';

/** A gate on an existing optional field, behind a feature that exists only in this test. */
const GATES: FieldGates = { desiredState: [{ path: 'liveAccess', feature: 'test-feature' }] };

const state = {
  revision: 1,
  network: {
    node: 'n1',
    addresses: ['10.93.0.1'],
    wireguard: [],
    services: [],
    bgp: { asn: 64512, routerId: '10.93.0.1', routeReflector: false, originate: [], sessions: [] },
    firewall: { sets: {}, rules: [] },
    dns: { domain: 'lw', records: [], visibility: {} },
  },
  controlPlane: { role: 'none', members: [], automaticFailover: false, scope: 'c1' },
  liveAccess: { nodeShell: true },
  lifecycle: 'active',
} as unknown as DesiredState;

function fakeStream() {
  const written: Envelope[] = [];

  return {
    written,
    stream: {
      writableEnded: false,
      write: (envelope: Envelope) => written.push(envelope),
      end() {
        this.writableEnded = true;
      },
    },
  };
}

const payloadOf = (envelope: Envelope) => {
  const decoded = decodeControlPlaneMessage(envelope);

  if (decoded.ok === false) throw new Error(decoded.error);

  return decoded.message.payload as Record<string, unknown>;
};

describe('agent session protocol gating (3.26)', () => {
  it('sends gated fields only after the node advertised the feature', () => {
    const { stream, written } = fakeStream();
    const session = createAgentSession('n1', stream, GATES);

    // Before the hello and for agents built before versioning: legacy, nothing gated.
    session.send(controlPlaneMessage('desiredState', state));
    session.protocol = negotiate({}, ['test-feature']);
    session.send(controlPlaneMessage('desiredState', state));
    // A current agent advertising the feature (plus one this control plane doesn't know).
    session.protocol = negotiate({ protocolVersion: 1, features: ['test-feature', 'from-the-future'] }, [
      'test-feature',
    ]);
    session.send(controlPlaneMessage('desiredState', state));

    expect(written.map((e) => 'liveAccess' in payloadOf(e))).toEqual([false, false, true]);
  });

  it('never sends live-migration messages to a node without the feature (3.10)', () => {
    const { stream, written } = fakeStream();
    const session = createAgentSession('n1', stream);
    const commit = () =>
      controlPlaneMessage(
        'migrationCommit',
        { migration: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', attempt: 1, replica: 'p1/d1/web/0', role: 'source' },
        { channel: 'migration:6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f' },
      );

    session.send(commit());
    // A current agent (protocol 2) that doesn't advertise live migration yet.
    session.protocol = negotiate({ protocolVersion: 2, features: [] });
    session.send(commit());
    expect(written).toHaveLength(0);

    session.protocol = negotiate({ protocolVersion: 2, features: ['live-migration'] });
    session.send(commit());
    expect(written.map((e) => [e.type, e.channel])).toEqual([
      ['migrationCommit', 'migration:6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f'],
    ]);
  });

  it('closes with an error message and stops writing', () => {
    const { stream, written } = fakeStream();
    const session = createAgentSession('n1', stream);

    session.close('bye');
    session.send(controlPlaneMessage('logAck', { ok: true }));

    expect(written).toHaveLength(1);
    expect(payloadOf(written[0])).toEqual({ code: 'closed', message: 'bye' });
    expect(session.protocol.version).toBe(0);
  });
});
