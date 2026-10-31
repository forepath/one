import {
  getBackorderStatusBadgeTone,
  getDatevExportStatusBadgeTone,
  getInvoiceStatusBadgeTone,
  getOfferStatusBadgeTone,
  getProvisioningStatusBadgeTone,
  getSubscriptionStatusBadgeTone,
} from './billing-status-labels';
import { projectTicketActivityActionBadgeTone } from './project-ticket-activity-labels';

// The country list registers i18n-iso-countries locales (JSON import), not needed here.
jest.mock('./billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

// 3.38 R10: object state = `fpc-badge [tone]`; the tones keep the former tint colours
// (paid → success, partially paid → info, issued → primary, overdue → danger, draft / void / unknown → neutral).
describe('billing status badge tones', () => {
  it('maps invoice states', () => {
    expect(getInvoiceStatusBadgeTone('draft')).toBe('neutral');
    expect(getInvoiceStatusBadgeTone('issued')).toBe('primary');
    expect(getInvoiceStatusBadgeTone('partially_paid')).toBe('info');
    expect(getInvoiceStatusBadgeTone('paid')).toBe('success');
    expect(getInvoiceStatusBadgeTone('overdue')).toBe('danger');
    expect(getInvoiceStatusBadgeTone('void')).toBe('neutral');
    expect(getInvoiceStatusBadgeTone(null)).toBe('neutral');
  });

  it('maps subscription, provisioning and backorder states', () => {
    expect(getSubscriptionStatusBadgeTone('active')).toBe('success');
    expect(getSubscriptionStatusBadgeTone('pending_cancel')).toBe('info');
    expect(getSubscriptionStatusBadgeTone('pending_instant_cancel')).toBe('danger');
    expect(getSubscriptionStatusBadgeTone('pending_backorder')).toBe('primary');
    expect(getSubscriptionStatusBadgeTone('canceled')).toBe('neutral');
    expect(getProvisioningStatusBadgeTone('pending')).toBe('info');
    expect(getProvisioningStatusBadgeTone('failed')).toBe('danger');
    expect(getBackorderStatusBadgeTone('fulfilled')).toBe('success');
    expect(getBackorderStatusBadgeTone('retrying')).toBe('info');
  });

  it('maps offer and DATEV export states', () => {
    expect(getOfferStatusBadgeTone('accepted')).toBe('success');
    expect(getOfferStatusBadgeTone('archived')).toBe('primary');
    expect(getOfferStatusBadgeTone('expired')).toBe('danger');
    expect(getDatevExportStatusBadgeTone('running')).toBe('info');
    expect(getDatevExportStatusBadgeTone('completed')).toBe('success');
  });

  it('maps project ticket activity actions', () => {
    expect(projectTicketActivityActionBadgeTone('CREATED')).toBe('success');
    expect(projectTicketActivityActionBadgeTone('DELETED')).toBe('danger');
    expect(projectTicketActivityActionBadgeTone('STATUS_CHANGED')).toBe('primary');
    expect(projectTicketActivityActionBadgeTone('PRIORITY_CHANGED')).toBe('warning');
    expect(projectTicketActivityActionBadgeTone('LOCKED')).toBe('neutral');
  });
});
