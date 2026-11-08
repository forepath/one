import { DEPLOYMENT_SOCKET_EVENTS } from '@forepath/agenstra/shared/util-opencode-config';
import type { Server } from 'socket.io';

import { CLIENTS_SOCKET_OUTBOUND_SCOPES } from '../auth/agenstra-websocket.scopes';

import { DeploymentRealtimeService } from './deployment-realtime.service';

describe('DeploymentRealtimeService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';

  it('emits workflow and run events to the workspace room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const service = new DeploymentRealtimeService();

    service.attachServer({ to } as unknown as Server);
    service.emitWorkflowUpsert({ id: 'w', clientId } as never);
    service.emitWorkflowRemoved({ clientId, workflowId: 'w' });
    service.emitRunUpsert({ id: 'r', clientId } as never);

    expect(to).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith(DEPLOYMENT_SOCKET_EVENTS.workflowUpsert, { id: 'w', clientId });
    expect(emit).toHaveBeenCalledWith(DEPLOYMENT_SOCKET_EVENTS.workflowRemoved, { clientId, workflowId: 'w' });
    expect(emit).toHaveBeenCalledWith(DEPLOYMENT_SOCKET_EVENTS.runUpsert, { id: 'r', clientId });
  });

  it('skips emits before the server is attached', () => {
    expect(() => new DeploymentRealtimeService().emitRunUpsert({ id: 'r', clientId } as never)).not.toThrow();
  });

  it('classifies the events for machine tokens as deployments:read', () => {
    for (const event of Object.values(DEPLOYMENT_SOCKET_EVENTS)) {
      expect(CLIENTS_SOCKET_OUTBOUND_SCOPES[event]).toEqual(['deployments:read']);
    }
  });
});
