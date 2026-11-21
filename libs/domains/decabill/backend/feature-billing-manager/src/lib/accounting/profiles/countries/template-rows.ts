import type { AccountingAccountRole, AccountingAccountType } from '../../constants/accounting.constants';
import type { ChartTemplateAccount } from '../accounting-profile.types';

/**
 * Compact table row for curated chart templates:
 * `[number, name, type, statementPosition, role?, automaticTaxCode?, cashBasisPosition?, externalCodes?]`.
 */
export type TemplateRow = [
  number: string,
  name: string,
  type: AccountingAccountType,
  position: string,
  role?: AccountingAccountRole,
  auto?: string,
  cashBasis?: string,
  external?: Record<string, string>,
];

export function buildAccounts(rows: TemplateRow[]): ChartTemplateAccount[] {
  return rows.map(([number, name, type, statementPosition, role, auto, cashBasis, external]) => {
    const externalCodes: Record<string, string> = { ...(external ?? {}), ...(cashBasis ? { cashBasis } : {}) };

    return {
      number,
      name,
      type,
      ...(role ? { role } : {}),
      statementPosition,
      ...(auto ? { automaticTaxCode: auto } : {}),
      ...(Object.keys(externalCodes).length > 0 ? { externalCodes } : {}),
    };
  });
}
