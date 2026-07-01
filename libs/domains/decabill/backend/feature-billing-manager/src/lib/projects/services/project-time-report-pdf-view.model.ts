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
}
