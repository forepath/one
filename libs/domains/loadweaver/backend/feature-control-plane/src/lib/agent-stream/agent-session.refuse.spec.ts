import {
  controlPlaneMessage,
  negotiate,
  type DesiredState,
  type Envelope,
  type FieldGates,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { buildWorkloadSpec, translateDeployments } from '../utils/workload-planning.utils';
import { createAgentSession, type ProtocolRefusal } from './agent-stream.server';

/**
 * Refuse-gated fields (M7 0.1): a message carrying `isolation` / `devices` / `microvm` / `vm` / block volumes for a
 * node whose agent lacks the feature is dropped and reported — never sent as a stripped copy.
 */
const REFUSE: FieldGates = { desiredState: [{ path: 'liveAccess', feature: 'test-feature', onMissing: 'refuse' }] };

const base = {
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
  lifecycle: 'active',
};

function microvmWorkload() {
  const { parsed } = translateDeployments(
    [
      {
        project: 'shop',
        name: 'store',
        spec: { compose: 'services:\n  app: { image: alpine:3, x-loadweaver: { runtime: microvm } }\n' },
      },
    ],
    new Map([['shop', projectSpecSchema.parse({})]]),
  );

  return buildWorkloadSpec(parsed[0], parsed[0].compose.services[0], 0, ['10.88.0.2'], 'lw', {
    images: { app: `alpine:3@sha256:${'a'.repeat(64)}` },
    secretVersions: {},
  });
}

function fakeStream() {
  const written: Envelope[] = [];

  return {
    written,
    stream: { writableEnded: false, write: (envelope: Envelope) => written.push(envelope), end: () => undefined },
  };
}

describe('agent session refuse gates (M7 0.1)', () => {
  it('drops the whole message and reports the refusal instead of stripping the field', () => {
    const { stream, written } = fakeStream();
    const refusals: ProtocolRefusal[] = [];
    const session = createAgentSession('n1', stream, REFUSE, (r) => refusals.push(r));

    session.protocol = negotiate({ protocolVersion: 2, features: [] }, ['test-feature']);
    session.send(controlPlaneMessage('desiredState', { ...base, liveAccess: { nodeShell: true } } as never));

    expect(written).toEqual([]);
    expect(refusals).toEqual([
      { node: 'n1', type: 'desiredState', path: 'liveAccess', feature: 'test-feature', at: expect.any(Date) },
    ]);

    // Without the field the message goes out; with the feature advertised too.
    session.send(controlPlaneMessage('desiredState', base as never));
    session.protocol = negotiate({ protocolVersion: 2, features: ['test-feature'] }, ['test-feature']);
    session.send(controlPlaneMessage('desiredState', { ...base, liveAccess: { nodeShell: true } } as never));

    expect(written).toHaveLength(2);
    expect(refusals).toHaveLength(1);
  });

  it('refuses a microVM workload for an agent without isolation-ladder (production gates)', () => {
    const { stream, written } = fakeStream();
    const refusals: ProtocolRefusal[] = [];
    const session = createAgentSession('n1', stream, undefined, (r) => refusals.push(r));
    const state = { ...base, workloads: [microvmWorkload()] } as unknown as DesiredState;

    session.protocol = negotiate({ protocolVersion: 2, features: ['live-migration'] });
    session.send(controlPlaneMessage('desiredState', state));

    expect(written).toEqual([]);
    expect(refusals[0]).toMatchObject({ type: 'desiredState', feature: 'isolation-ladder' });
    expect(refusals[0].path).toContain('isolation');
  });
});
