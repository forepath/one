import { BadRequestException } from '@nestjs/common';

import { resolveProjectBillTimeRange } from './project-bill-time-range.utils';

describe('project-bill-time-range.utils', () => {
  it('accepts valid range', () => {
    const from = new Date('2026-06-01T08:00:00.000Z');
    const to = new Date('2026-06-01T17:00:00.000Z');

    expect(resolveProjectBillTimeRange(from, to)).toEqual({ from, to });
  });

  it('rejects invalid dates', () => {
    expect(() => resolveProjectBillTimeRange(new Date('invalid'), new Date())).toThrow(BadRequestException);
  });

  it('rejects end before start', () => {
    const from = new Date('2026-06-02T10:00:00.000Z');
    const to = new Date('2026-06-01T10:00:00.000Z');

    expect(() => resolveProjectBillTimeRange(from, to)).toThrow(BadRequestException);
  });

  it('rejects equal start and end', () => {
    const at = new Date('2026-06-01T10:00:00.000Z');

    expect(() => resolveProjectBillTimeRange(at, at)).toThrow(BadRequestException);
  });
});
