import type { ProjectEstimate } from '../types/project-estimator.types';

export const PROJECT_ESTIMATE_CONTACT_MESSAGE_MAX_LENGTH = 5000;

export interface ProjectEstimateContactMessageLabels {
  intro: string;
  projectDescriptionHeading: string;
  summaryHeading: string;
  lineItemsHeading: string;
  subtotalLabel: string;
  assumptionsHeading: string;
}

export interface FormatProjectEstimateContactMessageInput {
  userDescription: string;
  estimate: ProjectEstimate;
  labels: ProjectEstimateContactMessageLabels;
  formatCurrency: (amount: number) => string;
  maxLength?: number;
}

export function formatProjectEstimateContactMessage(input: FormatProjectEstimateContactMessageInput): string {
  const sections: string[] = [input.labels.intro.trim()];

  const trimmedDescription = input.userDescription.trim();

  if (trimmedDescription.length > 0) {
    sections.push(`${input.labels.projectDescriptionHeading}\n${trimmedDescription}`);
  }

  sections.push(`${input.labels.summaryHeading}\n${input.estimate.summary.trim()}`);

  const lineItemLines = input.estimate.lineItems.map(
    (lineItem) => `- ${lineItem.serviceName}: ${lineItem.description} — ${input.formatCurrency(lineItem.lineTotal)}`,
  );

  if (lineItemLines.length > 0) {
    sections.push(`${input.labels.lineItemsHeading}\n${lineItemLines.join('\n')}`);
  }

  sections.push(`${input.labels.subtotalLabel} ${input.formatCurrency(input.estimate.subtotalNet)}`);

  if (input.estimate.assumptions.length > 0) {
    const assumptionLines = input.estimate.assumptions.map((assumption) => `- ${assumption}`);
    sections.push(`${input.labels.assumptionsHeading}\n${assumptionLines.join('\n')}`);
  }

  sections.push(input.estimate.disclaimer.trim());

  const message = sections.filter((section) => section.length > 0).join('\n\n');
  const maxLength = input.maxLength ?? PROJECT_ESTIMATE_CONTACT_MESSAGE_MAX_LENGTH;

  if (message.length <= maxLength) {
    return message;
  }

  const truncationNotice = '\n\n[Message truncated due to length limit.]';
  const availableLength = maxLength - truncationNotice.length;

  return `${message.slice(0, Math.max(0, availableLength)).trimEnd()}${truncationNotice}`;
}
