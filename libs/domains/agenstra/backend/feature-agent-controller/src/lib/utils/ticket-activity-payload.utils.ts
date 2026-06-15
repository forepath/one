import { TicketActionType } from '../entities/ticket.enums';

export interface FieldChange {
  old: unknown;
  new: unknown;
}

/**
 * Builds a single FIELD_UPDATED payload from changed ticket fields.
 */
export function buildFieldUpdatedPayload(changes: Record<string, FieldChange>): Record<string, unknown> {
  return { fields: changes };
}

/**
 * Picks a single action type for a PATCH: specific enum if only that key changed, else FIELD_UPDATED.
 */
export function derivePatchActionType(changes: Record<string, FieldChange>): TicketActionType {
  const keys = Object.keys(changes);

  if (keys.length === 1) {
    const k = keys[0];

    if (k === 'status') {
      return TicketActionType.STATUS_CHANGED;
    }

    if (k === 'priority') {
      return TicketActionType.PRIORITY_CHANGED;
    }

    if (k === 'clientId') {
      return TicketActionType.WORKSPACE_MOVED;
    }

    if (k === 'parentId') {
      return TicketActionType.PARENT_CHANGED;
    }
  }

  return TicketActionType.FIELD_UPDATED;
}
