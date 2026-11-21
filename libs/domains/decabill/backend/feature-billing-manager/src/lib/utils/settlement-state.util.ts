import { InvoiceStatus } from '../constants/invoice-status.constants';
import {
  BALANCE_INCREASING_SETTLEMENT_TYPES,
  BALANCE_REDUCING_SETTLEMENT_TYPES,
  SettlementType,
} from '../constants/settlement.constants';

export interface SettlementLike {
  type: SettlementType;
  amount: number | string;
  occurredAt: Date;
}

export interface SettlementStateInput {
  totalGross: number | string;
  dueDate?: Date | string | null;
  settlements: SettlementLike[];
  now?: Date;
}

export interface SettlementState {
  /** Remaining amount due; negative = customer credit (overpaid / over-credited). */
  balanceDue: number;
  status: InvoiceStatus;
  paidAt: Date | null;
  /** Net cash received (payments − reversals − refunds). */
  cashNet: number;
}

const EPSILON = 0.005;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON * Math.sign(value)) * 100) / 100;
}

function sumOf(settlements: SettlementLike[], types: SettlementType[]): number {
  return settlements.filter((s) => types.includes(s.type)).reduce((total, s) => total + Number(s.amount), 0);
}

function startOfUtcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function isPastDue(dueDate: Date | string | null | undefined, now: Date): boolean {
  if (!dueDate) {
    return false;
  }

  const due = typeof dueDate === 'string' ? new Date(`${dueDate.slice(0, 10)}T00:00:00Z`) : dueDate;

  return startOfUtcDay(due) < startOfUtcDay(now);
}

/**
 * Derives balance due, status and paid date of an issued (customer or supplier) invoice from its total and
 * settlements. Callers handle DRAFT and VOID themselves (settlements never apply to them).
 */
export function deriveSettlementState(input: SettlementStateInput): SettlementState {
  const now = input.now ?? new Date();
  const total = roundMoney(Number(input.totalGross));
  const reducing = sumOf(input.settlements, BALANCE_REDUCING_SETTLEMENT_TYPES);
  const increasing = sumOf(input.settlements, BALANCE_INCREASING_SETTLEMENT_TYPES);
  const balanceDue = roundMoney(total - reducing + increasing);
  const cashNet = roundMoney(
    sumOf(input.settlements, [SettlementType.PAYMENT]) -
      sumOf(input.settlements, [SettlementType.PAYMENT_REVERSAL, SettlementType.REFUND]),
  );
  const writtenOff = sumOf(input.settlements, [SettlementType.WRITE_OFF]);

  if (balanceDue <= EPSILON) {
    if (input.settlements.length === 0 || cashNet > EPSILON) {
      const payments = input.settlements.filter((s) => s.type === SettlementType.PAYMENT);
      const paidAt =
        payments.length > 0
          ? payments.reduce((latest, s) => (s.occurredAt > latest ? s.occurredAt : latest), payments[0].occurredAt)
          : now;

      return { balanceDue, status: InvoiceStatus.PAID, paidAt, cashNet };
    }

    return {
      balanceDue,
      status: writtenOff > EPSILON ? InvoiceStatus.WRITTEN_OFF : InvoiceStatus.CREDITED,
      paidAt: null,
      cashNet,
    };
  }

  if (isPastDue(input.dueDate, now)) {
    return { balanceDue, status: InvoiceStatus.OVERDUE, paidAt: null, cashNet };
  }

  if (balanceDue < total - EPSILON) {
    return { balanceDue, status: InvoiceStatus.PARTIALLY_PAID, paidAt: null, cashNet };
  }

  return { balanceDue, status: InvoiceStatus.ISSUED, paidAt: null, cashNet };
}

/** Effect sign of a settlement on the open balance (+1 reduces, −1 increases). */
export function settlementBalanceSign(type: SettlementType): 1 | -1 {
  return BALANCE_REDUCING_SETTLEMENT_TYPES.includes(type) ? 1 : -1;
}
