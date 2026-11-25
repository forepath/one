import { BadRequestException } from '@nestjs/common';

/** Clock skew tolerated for a manually entered send time (client clocks, time zones of date-only inputs). */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Send time of a document marked as sent manually: the given time (default now), never in the future and never
 * before the document was finalized (issued / voided / archived).
 */
export function resolveManualSentAt(
  sentAt: Date | undefined | null,
  finalizedAt: Date | string | undefined | null,
  now: Date = new Date(),
): Date {
  const at = sentAt ?? now;

  if (Number.isNaN(at.getTime())) {
    throw new BadRequestException('sentAt must be a valid date');
  }

  if (at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new BadRequestException('sentAt must not be in the future');
  }

  const finalized = finalizedAt ? new Date(finalizedAt) : null;

  // Date-only inputs (midnight) on the finalization day are fine: compare by calendar day.
  if (finalized && !Number.isNaN(finalized.getTime()) && startOfUtcDay(at) < startOfUtcDay(finalized)) {
    throw new BadRequestException('sentAt must not be before the document was finalized');
  }

  return at.getTime() > now.getTime() ? now : at;
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
