import { BadRequestException } from '@nestjs/common';

export interface ResolvedProjectBillTimeRange {
  from: Date;
  to: Date;
}

export function resolveProjectBillTimeRange(from: Date, to: Date): ResolvedProjectBillTimeRange {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException('Invalid bill time range');
  }

  if (to.getTime() <= from.getTime()) {
    throw new BadRequestException('End time must be after start time');
  }

  return { from, to };
}
