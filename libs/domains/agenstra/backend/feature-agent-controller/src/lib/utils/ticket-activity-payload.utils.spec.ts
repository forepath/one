import { TicketActionType } from '../entities/ticket.enums';

import { derivePatchActionType } from './ticket-activity-payload.utils';

describe('ticket-activity-payload.utils', () => {
  describe('derivePatchActionType', () => {
    it('returns STATUS_CHANGED when only status changes', () => {
      expect(derivePatchActionType({ status: { old: 'draft', new: 'todo' } })).toBe(TicketActionType.STATUS_CHANGED);
    });

    it('returns FIELD_UPDATED when multiple fields change', () => {
      expect(
        derivePatchActionType({
          status: { old: 'draft', new: 'todo' },
          title: { old: 'a', new: 'b' },
        }),
      ).toBe(TicketActionType.FIELD_UPDATED);
    });
  });
});
