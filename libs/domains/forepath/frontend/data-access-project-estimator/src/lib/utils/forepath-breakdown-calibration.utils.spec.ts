import { calibrateProjectBreakdown, shouldIncludeTravelInBreakdown } from './forepath-breakdown-calibration.utils';
import { ForepathPricingCalculatorService } from '../services/forepath-pricing-calculator.service';

const MISSING_PERSONS_PROMPT =
  'I want to build a somewhat complex software. The public should be able to support police and emts when searching for missing people. Therefore a map like what3words build on top of openstreetmap with an overlay should allow to mark quadrants if searched by a person. Double quadrant checks can be required. I need the public facing app with an interface and an interface for administrators as well as people who create searches. This app should be available as Webapp, iOS app and Android app. It must comply with German law!';

describe('forepath breakdown calibration utils', () => {
  it('should remove travel unless the prompt requests on-site work', () => {
    const calibrated = calibrateProjectBreakdown(
      {
        summary: 'Portal build',
        lineItems: [
          {
            serviceId: 'software-development',
            description: 'Web portal',
            billingUnits: 100,
          },
          {
            serviceId: 'travel-km',
            description: 'Client visit',
            quantity: 120,
          },
        ],
        assumptions: [],
        confidence: 'medium',
      },
      'build a customer portal with authentication',
    );

    expect(calibrated.lineItems.map((item) => item.serviceId)).toEqual(['software-development']);
    expect(calibrated.lineItems[0]?.billingUnits).toBe(520);
    expect(calibrated.assumptions.some((assumption) => assumption.includes('Travel costs excluded'))).toBe(true);
  });

  it('should keep travel for on-site prompts', () => {
    expect(shouldIncludeTravelInBreakdown('Need on-site installation at the client site')).toBe(true);

    const calibrated = calibrateProjectBreakdown(
      {
        summary: 'On-site rollout',
        lineItems: [
          {
            serviceId: 'software-development',
            description: 'Deployment support',
            billingUnits: 48,
          },
          {
            serviceId: 'travel-km',
            description: 'Client visit',
            quantity: 80,
          },
        ],
        assumptions: [],
        confidence: 'medium',
      },
      'Need on-site installation at the client site',
    );

    expect(calibrated.lineItems.map((item) => item.serviceId)).toEqual(['software-development', 'travel-km']);
  });

  it('should snap under-estimated software-development units toward standard tiers', () => {
    const calibrated = calibrateProjectBreakdown(
      {
        summary: 'Internal tool',
        lineItems: [
          {
            serviceId: 'software-development',
            description: 'Internal tool',
            billingUnits: 90,
          },
        ],
        assumptions: [],
        confidence: 'medium',
      },
      'Need an internal tool with a new API integration',
    );

    expect(calibrated.lineItems[0]?.billingUnits).toBe(160);
  });

  it('should inject software-development when a lite model returns only consulting or travel', () => {
    const pricingCalculator = new ForepathPricingCalculatorService();

    const calibrated = calibrateProjectBreakdown(
      {
        summary: 'Missing persons coordination platform',
        lineItems: [
          {
            serviceId: 'consulting',
            description: 'Initial workshop',
            billingUnits: 48,
          },
          {
            serviceId: 'travel-km',
            description: 'Client visit',
            quantity: 120,
          },
        ],
        assumptions: [],
        confidence: 'low',
      },
      MISSING_PERSONS_PROMPT,
    );

    const estimate = pricingCalculator.calculateEstimate(calibrated);

    expect(calibrated.lineItems.some((item) => item.serviceId === 'software-development')).toBe(true);
    expect(calibrated.lineItems.find((item) => item.serviceId === 'software-development')?.billingUnits).toBe(1600);
    expect(estimate.subtotalNet).toBeGreaterThan(50000);
    expect(estimate.subtotalNet).toBeLessThan(60000);
  });

  it('should raise under-scoped development totals for complex multi-platform prompts', () => {
    const pricingCalculator = new ForepathPricingCalculatorService();

    const calibrated = calibrateProjectBreakdown(
      {
        summary: 'Search coordination app',
        lineItems: [
          {
            serviceId: 'software-development',
            description: 'Basic app shell',
            billingUnits: 48,
          },
        ],
        assumptions: [],
        confidence: 'low',
      },
      MISSING_PERSONS_PROMPT,
    );

    const estimate = pricingCalculator.calculateEstimate(calibrated);

    expect(calibrated.lineItems[0]?.billingUnits).toBe(1600);
    expect(estimate.subtotalNet).toBeGreaterThan(50000);
  });

  it('should inject consulting when a lite model under-scopes a consulting-only request', () => {
    const pricingCalculator = new ForepathPricingCalculatorService();
    const prompt =
      'We need cloud and security consulting with discovery workshops, architecture review, and a prioritized roadmap for ISO 27001 readiness.';

    const calibrated = calibrateProjectBreakdown(
      {
        summary: 'Consulting request',
        lineItems: [
          {
            serviceId: 'travel-km',
            description: 'Client visit',
            quantity: 80,
          },
        ],
        assumptions: [],
        confidence: 'low',
      },
      prompt,
    );

    const estimate = pricingCalculator.calculateEstimate(calibrated);

    expect(calibrated.lineItems.some((item) => item.serviceId === 'consulting')).toBe(true);
    expect(calibrated.lineItems.find((item) => item.serviceId === 'consulting')?.billingUnits).toBe(1600);
    expect(estimate.subtotalNet).toBeGreaterThan(50000);
  });

  it('should inject it-systems when a lite model under-scopes a managed IT request', () => {
    const pricingCalculator = new ForepathPricingCalculatorService();
    const prompt =
      'We need managed IT for network monitoring, backup operations, and Microsoft 365 administration for about 80 workstations.';

    const calibrated = calibrateProjectBreakdown(
      {
        summary: 'Managed IT request',
        lineItems: [
          {
            serviceId: 'software-development',
            description: 'Ops dashboard',
            billingUnits: 48,
          },
        ],
        assumptions: [],
        confidence: 'low',
      },
      prompt,
    );

    const estimate = pricingCalculator.calculateEstimate(calibrated);

    expect(calibrated.lineItems.some((item) => item.serviceId === 'it-systems')).toBe(true);
    expect(calibrated.lineItems.find((item) => item.serviceId === 'it-systems')?.billingUnits).toBe(1600);
    expect(estimate.subtotalNet).toBeGreaterThan(45000);
  });

  it('should apply emergency rate tiers for urgent it-systems requests', () => {
    const calibrated = calibrateProjectBreakdown(
      {
        summary: 'Emergency support',
        lineItems: [
          {
            serviceId: 'it-systems',
            description: 'Firewall recovery',
            billingUnits: 48,
          },
        ],
        assumptions: [],
        confidence: 'low',
      },
      'Need emergency firewall support this Sunday for our office network.',
    );

    expect(calibrated.lineItems[0]?.rateTier).toBe('emergency-sunday');
    expect(calibrated.lineItems[0]?.billingUnits).toBeGreaterThanOrEqual(48);
  });
});
