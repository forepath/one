import { BadRequestException } from '@nestjs/common';

import { resolveManualSentAt } from './manual-delivery.util';

describe('resolveManualSentAt', () => {
  const now = new Date('2026-11-25T12:00:00Z');

  it('defaults to now', () => {
    expect(resolveManualSentAt(undefined, '2026-11-01T00:00:00Z', now)).toEqual(now);
  });

  it('accepts a past time after finalization, including a date-only value on the finalization day', () => {
    expect(resolveManualSentAt(new Date('2026-11-20T08:00:00Z'), new Date('2026-11-01'), now)).toEqual(
      new Date('2026-11-20T08:00:00Z'),
    );
    expect(resolveManualSentAt(new Date('2026-11-01'), new Date('2026-11-01T15:30:00Z'), now)).toEqual(
      new Date('2026-11-01'),
    );
  });

  it('clamps small clock skew to now and rejects the future', () => {
    expect(resolveManualSentAt(new Date(now.getTime() + 60_000), null, now)).toEqual(now);
    expect(() => resolveManualSentAt(new Date('2026-11-26T12:00:00Z'), null, now)).toThrow(BadRequestException);
  });

  it('rejects times before finalization and invalid dates', () => {
    expect(() => resolveManualSentAt(new Date('2026-10-31T23:00:00Z'), new Date('2026-11-01T10:00:00Z'), now)).toThrow(
      /before the document was finalized/,
    );
    expect(() => resolveManualSentAt(new Date('nope'), null, now)).toThrow(/valid date/);
  });
});
