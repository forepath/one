import type { ProjectEstimate } from '../types/project-estimator.types';

import {
  formatProjectEstimateContactMessage,
  type ProjectEstimateContactMessageLabels,
} from './format-project-estimate-contact-message.utils';

const labels: ProjectEstimateContactMessageLabels = {
  intro: 'I would like to discuss the following instant quote.',
  projectDescriptionHeading: 'Project description',
  summaryHeading: 'Summary',
  lineItemsHeading: 'Line items',
  subtotalLabel: 'Subtotal (net):',
  assumptionsHeading: 'Assumptions',
};

const sampleEstimate: ProjectEstimate = {
  summary: 'Workshop and discovery for a new platform.',
  lineItems: [
    {
      serviceId: 'consulting',
      serviceName: 'Consulting',
      description: 'Discovery workshop',
      billingUnits: 160,
      unitLabel: '15-minute billing unit',
      unitPrice: 33.76,
      lineTotal: 5401.6,
    },
  ],
  subtotalNet: 5401.6,
  assumptions: ['Remote delivery assumed.'],
  confidence: 'medium',
  disclaimer: 'Indicative estimate only, excluding statutory VAT.',
};

describe('formatProjectEstimateContactMessage', () => {
  it('should format the quote as plain text without table markup', () => {
    const message = formatProjectEstimateContactMessage({
      userDescription: 'We need a discovery workshop.',
      estimate: sampleEstimate,
      labels,
      formatCurrency: (amount) => `EUR ${amount.toFixed(2)}`,
    });

    expect(message).toContain('Project description');
    expect(message).toContain('We need a discovery workshop.');
    expect(message).toContain('- Consulting: Discovery workshop — EUR 5401.60');
    expect(message).toContain('Subtotal (net): EUR 5401.60');
    expect(message).toContain('- Remote delivery assumed.');
    expect(message).not.toContain('<table');
    expect(message).not.toContain('|');
  });

  it('should truncate messages that exceed the maximum length', () => {
    const message = formatProjectEstimateContactMessage({
      userDescription: 'x'.repeat(6_000),
      estimate: sampleEstimate,
      labels,
      formatCurrency: (amount) => `EUR ${amount.toFixed(2)}`,
      maxLength: 500,
    });

    expect(message.length).toBeLessThanOrEqual(500);
    expect(message).toContain('[Message truncated due to length limit.]');
  });
});
