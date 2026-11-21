import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SettlementType } from '../constants/settlement.constants';

import { deriveSettlementState, roundMoney } from './settlement-state.util';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-20T12:00:00Z');

describe('deriveSettlementState', () => {
  it('keeps an untouched invoice issued until its due date passes', () => {
    expect(deriveSettlementState({ totalGross: 119, dueDate: '2026-12-01', settlements: [], now: NOW })).toEqual({
      balanceDue: 119,
      status: InvoiceStatus.ISSUED,
      paidAt: null,
      cashNet: 0,
    });
    expect(deriveSettlementState({ totalGross: 119, dueDate: '2026-11-01', settlements: [], now: NOW }).status).toBe(
      InvoiceStatus.OVERDUE,
    );
  });

  it('records partial payments as partially paid', () => {
    const state = deriveSettlementState({
      totalGross: 119,
      dueDate: '2026-12-01',
      settlements: [{ type: SettlementType.PAYMENT, amount: '50', occurredAt: at('2026-11-10T00:00:00Z') }],
      now: NOW,
    });

    expect(state).toEqual(
      expect.objectContaining({ balanceDue: 69, status: InvoiceStatus.PARTIALLY_PAID, cashNet: 50 }),
    );
  });

  it('marks paid with the date of the latest payment', () => {
    const state = deriveSettlementState({
      totalGross: 119,
      settlements: [
        { type: SettlementType.PAYMENT, amount: 19, occurredAt: at('2026-11-02T00:00:00Z') },
        { type: SettlementType.PAYMENT, amount: 100, occurredAt: at('2026-11-15T00:00:00Z') },
      ],
      now: NOW,
    });

    expect(state.status).toBe(InvoiceStatus.PAID);
    expect(state.paidAt).toEqual(at('2026-11-15T00:00:00Z'));
  });

  it('distinguishes settlement by credit (credited) and write-off from cash payments', () => {
    expect(
      deriveSettlementState({
        totalGross: 119,
        settlements: [{ type: SettlementType.CREDIT, amount: 119, occurredAt: NOW }],
        now: NOW,
      }).status,
    ).toBe(InvoiceStatus.CREDITED);
    expect(
      deriveSettlementState({
        totalGross: 119,
        settlements: [
          { type: SettlementType.PAYMENT, amount: 19, occurredAt: NOW },
          { type: SettlementType.PAYMENT_REVERSAL, amount: 19, occurredAt: NOW },
          { type: SettlementType.WRITE_OFF, amount: 119, occurredAt: NOW },
        ],
        now: NOW,
      }).status,
    ).toBe(InvoiceStatus.WRITTEN_OFF);
  });

  it('keeps over-crediting as customer credit (negative balance) until refunded', () => {
    const credited = deriveSettlementState({
      totalGross: 100,
      settlements: [
        { type: SettlementType.PAYMENT, amount: 100, occurredAt: NOW },
        { type: SettlementType.CREDIT, amount: 30, occurredAt: NOW },
      ],
      now: NOW,
    });

    expect(credited).toEqual(expect.objectContaining({ balanceDue: -30, status: InvoiceStatus.PAID }));

    const refunded = deriveSettlementState({
      totalGross: 100,
      settlements: [
        { type: SettlementType.PAYMENT, amount: 100, occurredAt: NOW },
        { type: SettlementType.CREDIT, amount: 30, occurredAt: NOW },
        { type: SettlementType.REFUND, amount: 30, occurredAt: NOW },
      ],
      now: NOW,
    });

    expect(refunded).toEqual(expect.objectContaining({ balanceDue: 0, cashNet: 70, status: InvoiceStatus.PAID }));
  });

  it('applies and returns customer credit transfers', () => {
    expect(
      deriveSettlementState({
        totalGross: 50,
        settlements: [{ type: SettlementType.CREDIT_TRANSFER_IN, amount: 50, occurredAt: NOW }],
        now: NOW,
      }).status,
    ).toBe(InvoiceStatus.CREDITED);
    expect(
      deriveSettlementState({
        totalGross: 100,
        settlements: [
          { type: SettlementType.PAYMENT, amount: 100, occurredAt: NOW },
          { type: SettlementType.CREDIT, amount: 30, occurredAt: NOW },
          { type: SettlementType.CREDIT_TRANSFER_OUT, amount: 30, occurredAt: NOW },
        ],
        now: NOW,
      }).balanceDue,
    ).toBe(0);
  });

  it('treats zero-total (promotional) invoices without settlements as paid', () => {
    expect(deriveSettlementState({ totalGross: 0, settlements: [], now: NOW }).status).toBe(InvoiceStatus.PAID);
  });

  it('rounds half away from zero for money', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });
});
