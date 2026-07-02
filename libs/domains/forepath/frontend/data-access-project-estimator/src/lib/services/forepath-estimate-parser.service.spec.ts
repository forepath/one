import { ForepathEstimateParserService } from './forepath-estimate-parser.service';

describe('ForepathEstimateParserService', () => {
  const service = new ForepathEstimateParserService();

  const validBreakdown = {
    summary: 'Portal project',
    lineItems: [
      {
        serviceId: 'software-development',
        description: 'Frontend and API',
        billingUnits: 8,
      },
    ],
    assumptions: ['Standard delivery hours'],
    confidence: 'medium',
  };

  it('should parse raw JSON output', () => {
    const parsed = service.parseModelOutput(JSON.stringify(validBreakdown));

    expect(parsed.summary).toBe('Portal project');
    expect(parsed.lineItems).toHaveLength(1);
  });

  it('should parse fenced JSON output', () => {
    const parsed = service.parseModelOutput(
      'Here is the result:\n```json\n' + JSON.stringify(validBreakdown) + '\n```',
    );

    expect(parsed.lineItems[0]?.serviceId).toBe('software-development');
  });

  it('should reject invalid service ids', () => {
    expect(() =>
      service.parseModelOutput(
        JSON.stringify({
          ...validBreakdown,
          lineItems: [{ serviceId: 'unknown', description: 'Test', billingUnits: 1 }],
        }),
      ),
    ).toThrow('Invalid serviceId');
  });

  it('should reject missing line items', () => {
    expect(() =>
      service.parseModelOutput(
        JSON.stringify({
          summary: 'Broken',
          lineItems: [],
          assumptions: [],
          confidence: 'low',
        }),
      ),
    ).toThrow('at least one line item');
  });
});
