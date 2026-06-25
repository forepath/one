import type { DatevExportScope } from '../constants/datev-export.constants';

export interface DatevExportUnitPayload {
  tenantId: string;
  scope: DatevExportScope;
  year: number;
  month: number;
  triggeredBy: string;
  force?: boolean;
}
