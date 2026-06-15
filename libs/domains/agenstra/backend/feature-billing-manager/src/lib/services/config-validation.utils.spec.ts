import { validateConfigSchema } from '../utils/config-validation.utils';

describe('validateConfigSchema', () => {
  it('returns errors for missing required fields', () => {
    const errors = validateConfigSchema({ required: ['region'] }, {});

    expect(errors.length).toBe(1);
  });

  it('returns errors for invalid types', () => {
    const errors = validateConfigSchema(
      { properties: { region: { type: 'string' }, count: { type: 'number' } } },
      { region: 123, count: 'test' },
    );

    expect(errors.length).toBe(2);
  });

  it('returns no errors for valid config', () => {
    const errors = validateConfigSchema(
      {
        required: ['region'],
        properties: { region: { type: 'string' }, count: { type: 'number' }, enabled: { type: 'boolean' } },
      },
      { region: 'fsn1', count: 2, enabled: false },
    );

    expect(errors.length).toBe(0);
  });

  it('returns error when string value is not in enum', () => {
    const errors = validateConfigSchema(
      {
        properties: { region: { type: 'string', enum: ['fsn1', 'nbg1'] } },
      },
      { region: 'invalid' },
    );

    expect(errors.some((e) => e.includes('region'))).toBe(true);
  });

  it('returns no errors when string value matches enum', () => {
    const errors = validateConfigSchema(
      {
        properties: { region: { type: 'string', enum: ['fsn1', 'nbg1'] } },
      },
      { region: 'nbg1' },
    );

    expect(errors.length).toBe(0);
  });
});
