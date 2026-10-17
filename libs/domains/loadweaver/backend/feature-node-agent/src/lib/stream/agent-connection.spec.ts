import { desiredState } from '../test-fixtures';
import { preferredEndpoints } from './agent-connection.service';

describe('preferredEndpoints', () => {
  const identity = {
    clusterId: 'c',
    nodeName: 'n1',
    controlPlaneUrl: 'https://cp',
    controlPlaneEndpoints: ['cp.example.com:7443'],
  };

  it('uses the join-time endpoints before any tunnel exists', () => {
    expect(preferredEndpoints(identity, null)).toEqual(['cp.example.com:7443']);
  });

  it('prefers control-plane members reachable over the overlay (make-before-break, 3.21)', () => {
    const state = desiredState(2, {
      controlPlane: {
        role: 'none',
        scope: 'c',
        automaticFailover: true,
        members: [
          { name: 'n2', address: '10.93.0.2', witness: false },
          { name: 'n3', address: '10.93.0.3', witness: false },
          { name: 'w', address: '10.93.0.9', witness: true },
        ],
      },
    });

    // Only n2 has a link from n1 in the fixture; n3 is unreachable, the witness runs no API.
    expect(preferredEndpoints(identity, state)).toEqual(['10.93.0.2:7443', 'cp.example.com:7443']);
  });
});
