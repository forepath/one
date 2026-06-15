import {
  collapseConsecutiveIdenticalResultParts,
  collapseRepeatedWholeCopiesInString,
  dropRedundantTrailingStreamResultParts,
  finalizeStreamingTranscriptParts,
  materializeDeltaPartsIntoInterleavedResults,
} from './materialize-streaming-deltas-for-transcript';

describe('materializeDeltaPartsIntoInterleavedResults', () => {
  it('flushes prose before each structured part and preserves order', () => {
    const parts = materializeDeltaPartsIntoInterleavedResults([
      { type: 'delta', delta: 'Exploring…\n' },
      { type: 'tool_call', tool: 'read', path: '/a' },
      { type: 'delta', delta: 'Done.\n' },
    ]);

    expect(parts).toEqual([
      { type: 'result', subtype: 'success', result: 'Exploring…\n' },
      { type: 'tool_call', tool: 'read', path: '/a' },
      { type: 'result', subtype: 'success', result: 'Done.\n' },
    ]);
  });

  it('places thinking and stream result after preceding delta runs', () => {
    const parts = materializeDeltaPartsIntoInterleavedResults([
      { type: 'thinking', thinking: 'plan' },
      { type: 'delta', delta: 'A' },
      { type: 'tool_call', id: '1' },
      { type: 'result', subtype: 'success', result: 'Final' },
    ]);

    expect(parts).toEqual([
      { type: 'thinking', thinking: 'plan' },
      { type: 'result', subtype: 'success', result: 'A' },
      { type: 'tool_call', id: '1' },
      { type: 'result', subtype: 'success', result: 'Final' },
    ]);
  });

  it('omits empty result parts when there are no deltas', () => {
    expect(materializeDeltaPartsIntoInterleavedResults([{ type: 'tool_call', id: 'x' }])).toEqual([
      { type: 'tool_call', id: 'x' },
    ]);
  });
});

describe('dropRedundantTrailingStreamResultParts', () => {
  it('removes a trailing stream result that duplicates earlier materialized prose', () => {
    const materialized = materializeDeltaPartsIntoInterleavedResults([
      { type: 'delta', delta: 'Hello ' },
      { type: 'tool_call', id: 't' },
      { type: 'delta', delta: 'world' },
      { type: 'result', subtype: 'success', result: 'Hello world' },
    ]);

    expect(dropRedundantTrailingStreamResultParts(materialized)).toEqual([
      { type: 'result', subtype: 'success', result: 'Hello ' },
      { type: 'tool_call', id: 't' },
      { type: 'result', subtype: 'success', result: 'world' },
    ]);
  });

  it('keeps the terminal result when it adds new content', () => {
    const parts = [
      { type: 'result', subtype: 'success', result: 'Part one.' },
      { type: 'tool_call', id: 't' },
      { type: 'result', subtype: 'success', result: 'Part one.\n\nPart two.' },
    ];

    expect(dropRedundantTrailingStreamResultParts(parts)).toEqual(parts);
  });

  it('does not remove the only result after tools when there were no delta segments', () => {
    const parts = [
      { type: 'tool_call', id: 'x' },
      { type: 'result', subtype: 'success', result: 'Done' },
    ];

    expect(dropRedundantTrailingStreamResultParts(parts)).toEqual(parts);
  });
});

describe('collapseRepeatedWholeCopiesInString', () => {
  it('collapses k identical concatenated segments when each segment is long enough', () => {
    const unit = 'x'.repeat(40);
    const triple = unit + unit + unit;

    expect(collapseRepeatedWholeCopiesInString(triple)).toBe(unit);
  });

  it('does not change short strings that happen to repeat as halves', () => {
    expect(collapseRepeatedWholeCopiesInString('abab')).toBe('abab');
  });
});

describe('collapseConsecutiveIdenticalResultParts', () => {
  it('merges three trailing identical Cursor result frames into one with merged metadata', () => {
    const essay = 'y'.repeat(50);
    const merged = collapseConsecutiveIdenticalResultParts([
      { type: 'tool_call', id: 't' },
      { type: 'result', subtype: 'success', result: essay },
      { type: 'result', subtype: 'success', result: essay, duration_ms: 12 },
      { type: 'result', subtype: 'success', result: essay, usage: { outputTokens: 1 } },
    ]);

    expect(merged).toEqual([
      { type: 'tool_call', id: 't' },
      { type: 'result', subtype: 'success', result: essay, duration_ms: 12, usage: { outputTokens: 1 } },
    ]);
  });
});

describe('finalizeStreamingTranscriptParts', () => {
  it('dedupes doubled prose inside one result plus duplicate NDJSON result lines', () => {
    const unit = 'z'.repeat(40);
    const doubledInFrame = unit + unit;
    const finalized = finalizeStreamingTranscriptParts([
      { type: 'tool_call', id: 'c' },
      { type: 'result', subtype: 'success', result: doubledInFrame },
      { type: 'result', subtype: 'success', result: unit, duration_ms: 99 },
    ]);

    expect(finalized).toEqual([
      { type: 'tool_call', id: 'c' },
      { type: 'result', subtype: 'success', result: unit, duration_ms: 99 },
    ]);
  });
});
