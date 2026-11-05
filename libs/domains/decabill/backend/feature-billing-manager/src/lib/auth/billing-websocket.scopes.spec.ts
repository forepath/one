import { parsePatScope, type SocketEventScopes } from '@forepath/identity/backend';

import { PROJECTS_BOARD_EVENTS } from '../projects/services/project-board-realtime.constants';

import { BILLING_PAT_SCOPES } from './billing-pat.scopes';
import {
  BILLING_SOCKET_ADMIN_METERS_SCOPE,
  BILLING_SOCKET_INBOUND_SCOPES,
  BILLING_SOCKET_OUTBOUND_SCOPES,
  BILLING_WEBSOCKETS,
  PROJECTS_SOCKET_INBOUND_SCOPES,
  projectsSocketOutboundScopes,
} from './billing-websocket.scopes';

const ALL_MAPS: Record<string, SocketEventScopes> = {
  BILLING_SOCKET_INBOUND_SCOPES,
  BILLING_SOCKET_OUTBOUND_SCOPES,
  PROJECTS_SOCKET_INBOUND_SCOPES,
  PROJECTS_OWNER: projectsSocketOutboundScopes(false),
  PROJECTS_CROSS_OWNER: projectsSocketOutboundScopes(true),
};

describe('Decabill websocket scopes', () => {
  it('only uses cataloged, pattern-conformant scopes', () => {
    const catalog = new Set<string>(BILLING_PAT_SCOPES);
    const problems: string[] = [];

    for (const [name, map] of Object.entries(ALL_MAPS)) {
      for (const [event, scopes] of Object.entries(map)) {
        for (const scope of scopes) {
          if (!parsePatScope(scope) || !catalog.has(scope)) {
            problems.push(`${name}.${event}: ${scope}`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
    expect(catalog.has(BILLING_SOCKET_ADMIN_METERS_SCOPE)).toBe(true);
  });

  it('catalogs exactly the websocket scopes the sockets use', () => {
    const used = new Set<string>();

    Object.values(ALL_MAPS).forEach((map) =>
      Object.values(map).forEach((scopes) =>
        scopes.filter((scope) => scope.startsWith('websocket:')).forEach((scope) => used.add(scope)),
      ),
    );

    expect([...used].sort()).toEqual(BILLING_PAT_SCOPES.filter((scope) => scope.startsWith('websocket:')).sort());
    expect(Object.values(BILLING_WEBSOCKETS).sort()).toEqual(['billing', 'projects']);
  });

  it('requires the socket scope on every inbound event', () => {
    for (const [event, scopes] of Object.entries(BILLING_SOCKET_INBOUND_SCOPES)) {
      expect({ event, ok: scopes.includes('websocket:billing:read') }).toEqual({ event, ok: true });
    }

    for (const [event, scopes] of Object.entries(PROJECTS_SOCKET_INBOUND_SCOPES)) {
      expect({ event, ok: scopes.includes('websocket:projects:read') }).toEqual({ event, ok: true });
    }
  });

  it('classifies every project board event for owners and cross-owner admins', () => {
    for (const crossOwner of [false, true]) {
      const map = projectsSocketOutboundScopes(crossOwner);

      expect(Object.values(PROJECTS_BOARD_EVENTS).filter((event) => !(event in map))).toEqual([]);
    }

    for (const scopes of Object.values(projectsSocketOutboundScopes(true))) {
      scopes.forEach((scope) => expect(scope.endsWith(':admin')).toBe(true));
    }
  });
});
