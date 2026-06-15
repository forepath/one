import type { TicketStatus } from './tickets.types';

/** Swimlane columns on the board (terminal statuses done/closed are excluded from lanes). */
export const BOARD_LANE_STATUSES = ['draft', 'todo', 'in_progress', 'prototype'] as const;

export type BoardLaneStatus = (typeof BOARD_LANE_STATUSES)[number];

export function isTerminalTicketStatus(status: TicketStatus): boolean {
  return status === 'done' || status === 'closed';
}

export function isBoardLaneStatus(status: TicketStatus): status is BoardLaneStatus {
  return (BOARD_LANE_STATUSES as readonly string[]).includes(status);
}
