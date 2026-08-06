import { BadRequestException } from '@nestjs/common';

import { assertDeclaredMeterCollectionInterval } from './declared-meter.dto';

describe('assertDeclaredMeterCollectionInterval', () => {
  const base = {
    key: 'cpu',
    name: 'CPU',
    aggregator: 'max' as const,
    defaultUnitPriceNet: 1,
  };

  it('allows omitted collectionIntervalMs', () => {
    expect(() => assertDeclaredMeterCollectionInterval(base)).not.toThrow();
  });

  it('allows positive collectionIntervalMs', () => {
    expect(() => assertDeclaredMeterCollectionInterval({ ...base, collectionIntervalMs: 60_000 })).not.toThrow();
  });

  it('rejects non-positive collectionIntervalMs', () => {
    expect(() => assertDeclaredMeterCollectionInterval({ ...base, collectionIntervalMs: 0 })).toThrow(
      BadRequestException,
    );
    expect(() => assertDeclaredMeterCollectionInterval({ ...base, collectionIntervalMs: -1 })).toThrow(
      BadRequestException,
    );
  });
});
