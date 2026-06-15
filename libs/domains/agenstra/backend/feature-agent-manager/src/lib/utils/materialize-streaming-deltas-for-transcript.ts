import { AgentResponseObject } from '../providers/agent-provider.interface';

/**
 * Streaming builds `streamedUnified` with `type: "delta"` chunks interleaved with tools, thinking, etc.
 * Persisting by stripping deltas and appending one synthetic `result` loses ordering; this converts each
 * contiguous run of deltas into a `result` part in place before non-delta frames.
 */
export function materializeDeltaPartsIntoInterleavedResults(
  streamedUnified: AgentResponseObject[],
): AgentResponseObject[] {
  const out: AgentResponseObject[] = [];
  let buf = '';
  const flush = () => {
    if (buf.length > 0) {
      out.push({ type: 'result', subtype: 'success', result: buf });
      buf = '';
    }
  };

  for (const part of streamedUnified) {
    const typ = String(part.type);
    const deltaChunk = (part as unknown as { delta?: unknown }).delta;

    if (typ === 'delta' && typeof deltaChunk === 'string') {
      buf += deltaChunk;
      continue;
    }

    flush();
    out.push(part);
  }

  flush();

  return out;
}

function extractResultTextBody(part: AgentResponseObject): string {
  const r = part['result'];

  if (typeof r === 'string') {
    return r;
  }

  if (r === undefined || r === null) {
    return '';
  }

  try {
    return JSON.stringify(r);
  } catch {
    return String(r);
  }
}

/** Collapse whitespace so we can compare stream summaries that differ only in newlines. */
function collapseWhitespaceForCompare(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function joinResultBodiesFromParts(parts: AgentResponseObject[]): string {
  let acc = '';

  for (const p of parts) {
    if (String(p.type) === 'result') {
      acc += extractResultTextBody(p);
    }
  }

  return acc;
}

/**
 * Providers often emit a terminal `{ type: "result" }` NDJSON line that repeats the full assistant
 * output already delivered as `delta` chunks. After materializing deltas into interleaved `result`
 * parts, that trailing frame would show the answer twice in the UI — remove it when it matches the
 * prose from earlier `result` parts in this turn.
 */
export function dropRedundantTrailingStreamResultParts(parts: AgentResponseObject[]): AgentResponseObject[] {
  if (parts.length < 2) {
    return parts;
  }

  const last = parts[parts.length - 1];

  if (String(last.type) !== 'result') {
    return parts;
  }

  const terminal = extractResultTextBody(last);

  if (!terminal.trim()) {
    return parts.slice(0, -1);
  }

  const prior = parts.slice(0, -1);
  const priorJoined = joinResultBodiesFromParts(prior);

  if (priorJoined === terminal) {
    return prior;
  }

  if (collapseWhitespaceForCompare(priorJoined) === collapseWhitespaceForCompare(terminal)) {
    return prior;
  }

  return parts;
}

const DEFAULT_MIN_UNIT_FOR_WHOLE_STRING_REPEAT = 32;
const MAX_REPEAT_COPIES_TO_DETECT = 10;

/**
 * Cursor stream-json sometimes repeats the full assistant answer multiple times inside one
 * `result` string (concatenated copies). Detect whole-string repetition (k identical segments) and
 * keep a single copy. Uses a minimum segment length to avoid false positives on short strings.
 */
export function collapseRepeatedWholeCopiesInString(
  s: string,
  minUnitLength = DEFAULT_MIN_UNIT_FOR_WHOLE_STRING_REPEAT,
): string {
  const n = s.length;

  if (n < minUnitLength * 2) {
    return s;
  }

  for (let k = Math.min(MAX_REPEAT_COPIES_TO_DETECT, n); k >= 2; k--) {
    if (n % k !== 0) {
      continue;
    }

    const unitLen = n / k;

    if (unitLen < minUnitLength) {
      continue;
    }

    const unit = s.slice(0, unitLen);
    let allMatch = true;

    for (let i = 1; i < k; i++) {
      if (s.slice(i * unitLen, (i + 1) * unitLen) !== unit) {
        allMatch = false;
        break;
      }
    }

    if (allMatch) {
      return unit;
    }
  }

  return s;
}

function normalizeResultPartRepeatedProse(part: AgentResponseObject): AgentResponseObject {
  if (String(part.type) !== 'result') {
    return part;
  }

  const raw = extractResultTextBody(part);

  if (!raw.trim()) {
    return part;
  }

  const collapsed = collapseRepeatedWholeCopiesInString(raw);

  if (collapsed === raw) {
    return part;
  }

  return { ...(part as Record<string, unknown>), result: collapsed } as AgentResponseObject;
}

/**
 * Cursor may emit several NDJSON `result` lines with the same prose (and richer metadata on the
 * last). `dropRedundantTrailingStreamResultParts` only removes one layer when the trailing body
 * equals the *concatenation* of all prior results — multiple identical copies break that check.
 * Merge consecutive `result` parts with the same normalized body and keep metadata from the later
 * frame.
 */
export function collapseConsecutiveIdenticalResultParts(parts: AgentResponseObject[]): AgentResponseObject[] {
  const out: AgentResponseObject[] = [];

  for (const p of parts) {
    if (String(p.type) !== 'result') {
      out.push(p);
      continue;
    }

    const last = out[out.length - 1];

    if (out.length > 0 && String(last.type) === 'result') {
      const prevBody = collapseWhitespaceForCompare(extractResultTextBody(last));
      const nextBody = collapseWhitespaceForCompare(extractResultTextBody(p));

      if (prevBody.length > 0 && prevBody === nextBody) {
        out[out.length - 1] = {
          ...(last as Record<string, unknown>),
          ...(p as Record<string, unknown>),
        } as AgentResponseObject;
        continue;
      }
    }

    out.push(p);
  }

  return out;
}

/**
 * Full post-processing for streamed unified frames before building `agenstra_turn.parts`.
 */
export function finalizeStreamingTranscriptParts(streamedUnified: AgentResponseObject[]): AgentResponseObject[] {
  const materialized = materializeDeltaPartsIntoInterleavedResults(streamedUnified);
  const proseNormalized = materialized.map((p) => normalizeResultPartRepeatedProse(p));

  return dropRedundantTrailingStreamResultParts(collapseConsecutiveIdenticalResultParts(proseNormalized));
}
