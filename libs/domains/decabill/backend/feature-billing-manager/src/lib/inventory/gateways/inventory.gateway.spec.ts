import { UserRole } from '@forepath/identity/backend';

import { INVENTORY_EVENTS } from '../services/inventory-realtime.constants';
import { InventoryRealtimeService } from '../services/inventory-realtime.service';

import { InventoryGateway } from './inventory.gateway';

function socket(userInfo: Record<string, unknown> | undefined, id = 's1') {
  return {
    id,
    data: { userInfo, tenantId: 'default' },
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
  };
}

describe('InventoryGateway', () => {
  const realtime = { attachServer: jest.fn(), emit: jest.fn() };
  const requestsRepository = { changeSignature: jest.fn() };
  let gateway: InventoryGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new InventoryGateway({} as never, realtime as never, requestsRepository as never);
  });

  afterEach(() => gateway.onModuleDestroy());

  it('denies non-admin users', async () => {
    const client = socket({ userId: 'u1', userRole: UserRole.USER, isApiKeyAuth: false });

    await gateway.handleSubscribe(client as never);

    expect(client.emit).toHaveBeenCalledWith('error', { message: 'Access denied' });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('denies API key sockets and unauthenticated sockets', async () => {
    const apiKey = socket({ isApiKeyAuth: true, userRole: UserRole.ADMIN });
    const anonymous = socket(undefined);

    await gateway.handleSubscribe(apiKey as never);
    await gateway.handleSubscribe(anonymous as never);

    expect(apiKey.join).not.toHaveBeenCalled();
    expect(anonymous.join).not.toHaveBeenCalled();
  });

  it('joins interactive admins to the tenant room only', async () => {
    const client = socket({ userId: 'admin', userRole: UserRole.ADMIN, isApiKeyAuth: false });

    await gateway.handleSubscribe(client as never);

    expect(client.join).toHaveBeenCalledWith(InventoryRealtimeService.tenantRoom('default'));
    expect(client.emit).toHaveBeenCalledWith('subscribeInventorySuccess', expect.any(Object));
  });

  it('pushes requestsChanged when the request marker changes (requests raised by workers)', async () => {
    const client = socket({ userId: 'admin', userRole: UserRole.ADMIN, isApiKeyAuth: false });

    await gateway.handleSubscribe(client as never);
    requestsRepository.changeSignature
      .mockResolvedValueOnce({ signature: '1:1:a', pendingCount: 1 })
      .mockResolvedValueOnce({ signature: '1:1:a', pendingCount: 1 })
      .mockResolvedValueOnce({ signature: '2:2:b', pendingCount: 2 });

    await gateway.pollRequestChanges();
    await gateway.pollRequestChanges();
    expect(realtime.emit).not.toHaveBeenCalled();

    await gateway.pollRequestChanges();
    expect(realtime.emit).toHaveBeenCalledWith(INVENTORY_EVENTS.requestsChanged, { pendingCount: 2 });
  });

  it('stops polling a tenant once its last subscriber leaves', async () => {
    const client = socket({ userId: 'admin', userRole: UserRole.ADMIN, isApiKeyAuth: false });

    await gateway.handleSubscribe(client as never);
    gateway.handleDisconnect(client as never);
    await gateway.pollRequestChanges();

    expect(requestsRepository.changeSignature).not.toHaveBeenCalled();
  });
});
