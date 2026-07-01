import { BadRequestException } from '@nestjs/common';

export interface ResolvedProjectTimeEntryRange {
  startedAt: Date;
  endedAt: Date;
  durationMinutes: number;
  recordedAt: Date;
}

export function resolveProjectTimeEntryRange(startedAt: Date, endedAt: Date): ResolvedProjectTimeEntryRange {
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new BadRequestException('Invalid time entry range');
  }

  if (endedAt.getTime() <= startedAt.getTime()) {
    throw new BadRequestException('End time must be after start time');
  }

  const durationMinutes = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));

  return {
    startedAt,
    endedAt,
    durationMinutes,
    recordedAt: startedAt,
  };
}
