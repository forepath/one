import { ticketLaneStatusLabel } from './ticket-lane-status-label';

describe('ticketLaneStatusLabel', () => {
  it('maps workflow status away from raw snake_case where applicable', () => {
    expect(ticketLaneStatusLabel('in_progress')).not.toBe('in_progress');
  });

  it('passes through unknown status unchanged', () => {
    expect(ticketLaneStatusLabel('future_lane')).toBe('future_lane');
  });
});
