import { formatServerTypeOption } from './server-type-format.utils';

describe('formatServerTypeOption', () => {
  const serverType = {
    id: 'cpx11',
    name: 'CPX11',
    cores: 2,
    memory: 4,
    disk: 80,
    priceMonthly: 4.51,
  };

  it('includes provider price by default', () => {
    expect(formatServerTypeOption(serverType)).toContain('€4.51/month');
  });

  it('omits provider price when includePrice is false', () => {
    const label = formatServerTypeOption(serverType, { includePrice: false });

    expect(label).toBe('CPX11 - 2 vCPU, 4GB RAM, 80GB Disk');
    expect(label).not.toContain('€');
  });
});
