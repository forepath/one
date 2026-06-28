import { BadRequestException } from '@nestjs/common';

import { resolveProjectTimeEntryRange } from './project-time-entry-range.utils';

describe('resolveProjectTimeEntryRange', () => {
  it('computes duration across multiple days', () => {
    const startedAt = new Date('2024-06-01T22:00:00.000Z');
    const endedAt = new Date('2024-06-03T10:30:00.000Z');

    const result = resolveProjectTimeEntryRange(startedAt, endedAt);

    expect(result.durationMinutes).toBe(2190);
    expect(result.recordedAt).toEqual(startedAt);
    expect(result.startedAt).toEqual(startedAt);
    expect(result.endedAt).toEqual(endedAt);
  });

  it('rejects end before start', () => {
    const startedAt = new Date('2024-06-02T10:00:00.000Z');
    const endedAt = new Date('2024-06-02T09:00:00.000Z');

    expect(() => resolveProjectTimeEntryRange(startedAt, endedAt)).toThrow(BadRequestException);
  });
});
