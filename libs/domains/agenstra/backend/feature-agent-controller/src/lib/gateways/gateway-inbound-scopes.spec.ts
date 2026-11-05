import { type SocketEventScopes } from '@forepath/identity/backend';
import { MESSAGE_MAPPING_METADATA, MESSAGE_METADATA } from '@nestjs/websockets/constants';

import {
  CLIENTS_SOCKET_INBOUND_SCOPES,
  PAGES_SOCKET_INBOUND_SCOPES,
  STATUS_SOCKET_INBOUND_SCOPES,
  TICKETS_SOCKET_INBOUND_SCOPES,
} from '../auth/agenstra-websocket.scopes';

import { ClientsGateway } from './clients.gateway';
import { KnowledgeBoardGateway } from './knowledge-board.gateway';
import { StatusGateway } from './status.gateway';
import { TicketsBoardGateway } from './tickets-board.gateway';

type GatewayClass = abstract new (...args: never[]) => unknown;

/** `@SubscribeMessage` names of a gateway class. */
function subscribedMessages(gateway: GatewayClass): string[] {
  const prototype = gateway.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .map((name) => prototype[name])
    .filter((handler) => typeof handler === 'function' && Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler))
    .map((handler) => Reflect.getMetadata(MESSAGE_METADATA, handler as object) as string)
    .sort();
}

describe('Agenstra gateway inbound scopes', () => {
  it.each<[string, GatewayClass, SocketEventScopes]>([
    ['clients', ClientsGateway, CLIENTS_SOCKET_INBOUND_SCOPES],
    ['status', StatusGateway, STATUS_SOCKET_INBOUND_SCOPES],
    ['tickets', TicketsBoardGateway, TICKETS_SOCKET_INBOUND_SCOPES],
    ['pages', KnowledgeBoardGateway, PAGES_SOCKET_INBOUND_SCOPES],
  ])('classifies every %s socket message handler for machine tokens', (_name, gateway, inbound) => {
    const handlers = subscribedMessages(gateway);

    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toEqual(Object.keys(inbound).sort());
  });
});
