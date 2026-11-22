import type { BillingDocumentBranding } from '../../services/billing-document-branding-config.service';

export interface ProjectTimeReportEntryView {
  period: string;
  duration: string;
  description: string;
  ticket: string;
  billingStatus: string;
}

export interface ProjectTimeReportViewModel {
  title: string;
  companyName: string;
  projectName: string;
  rangeLabel: string;
  invoiceNumber?: string;
  entries: ProjectTimeReportEntryView[];
  totalDuration: string;
  authenticityShortSha?: string;
  /** Logo and accent color; filled in by the template service when absent. */
  branding?: BillingDocumentBranding;
}
