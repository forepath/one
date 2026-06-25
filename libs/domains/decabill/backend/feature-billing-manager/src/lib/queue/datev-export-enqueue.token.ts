import type { DatevExportUnitPayload } from './datev-export.payload';

export const DATEV_EXPORT_ENQUEUE = Symbol('DATEV_EXPORT_ENQUEUE');

export interface DatevExportEnqueuePort {
  enqueueUnit(payload: DatevExportUnitPayload): Promise<void>;
}
