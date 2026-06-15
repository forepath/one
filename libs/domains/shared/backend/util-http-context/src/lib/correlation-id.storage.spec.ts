import { getCorrelationId, runWithCorrelationId } from './correlation-id.storage';

describe('correlation-id.storage', () => {
  it('exposes correlation id inside runWithCorrelationId callback', () => {
    runWithCorrelationId('corr-1', () => {
      expect(getCorrelationId()).toBe('corr-1');
    });
  });

  it('clears correlation id after callback completes', () => {
    runWithCorrelationId('corr-2', () => {
      expect(getCorrelationId()).toBe('corr-2');
    });
    expect(getCorrelationId()).toBeUndefined();
  });

  it('supports nested runWithCorrelationId', () => {
    runWithCorrelationId('outer', () => {
      expect(getCorrelationId()).toBe('outer');
      runWithCorrelationId('inner', () => {
        expect(getCorrelationId()).toBe('inner');
      });
      expect(getCorrelationId()).toBe('outer');
    });
  });
});
