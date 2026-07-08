import {
  buildProvisioningOptionsFromKeys,
  DEFAULT_INTEGRATED_PROVISIONING_OPTION_KEYS,
  encodeProvisioningOptionKey,
  integratedProvisioningServiceLabel,
  parsePlanProvisioningOptions,
  parseProvisioningOptionKey,
  planProvisioningOptionKeysFromDefaults,
} from './plan-provisioning-options.utils';

describe('planProvisioningOptionsUtils', () => {
  it('exposes default integrated option keys', () => {
    expect(DEFAULT_INTEGRATED_PROVISIONING_OPTION_KEYS).toEqual(['integrated:controller', 'integrated:manager']);
  });

  it('integratedProvisioningServiceLabel returns Agenstra stack names', () => {
    expect(integratedProvisioningServiceLabel('controller')).toBe('Agenstra Controller');
    expect(integratedProvisioningServiceLabel('manager')).toBe('Agenstra Manager');
  });

  it('encodes integrated and custom option keys', () => {
    expect(encodeProvisioningOptionKey({ type: 'integrated', service: 'controller' })).toBe('integrated:controller');
    expect(encodeProvisioningOptionKey({ type: 'custom', cloudInitConfigId: 'cfg-1' })).toBe('custom:cfg-1');
  });

  it('parses plan defaults with provisioningOptions only', () => {
    expect(
      parsePlanProvisioningOptions({
        provisioningOptions: [
          { type: 'integrated', service: 'manager' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      }),
    ).toEqual([
      { type: 'integrated', service: 'manager' },
      { type: 'custom', cloudInitConfigId: 'cfg-1' },
    ]);
    expect(
      parsePlanProvisioningOptions({
        service: 'custom',
        cloudInitConfigId: 'cfg-legacy',
      }),
    ).toEqual([]);
  });

  it('builds keys from defaults and round-trips selected keys', () => {
    const defaults = {
      provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-legacy' }],
    };

    expect(planProvisioningOptionKeysFromDefaults(defaults)).toEqual(['custom:cfg-legacy']);
    expect(buildProvisioningOptionsFromKeys(['integrated:controller', 'custom:cfg-1'])).toEqual([
      { type: 'integrated', service: 'controller' },
      { type: 'custom', cloudInitConfigId: 'cfg-1' },
    ]);
  });

  it('infers legacy integrated service keys when provisioningOptions are absent', () => {
    expect(planProvisioningOptionKeysFromDefaults({ service: 'manager' })).toEqual(['integrated:manager']);
    expect(planProvisioningOptionKeysFromDefaults({ service: 'custom', cloudInitConfigId: 'cfg-legacy' })).toEqual([
      'custom:cfg-legacy',
    ]);
    expect(planProvisioningOptionKeysFromDefaults({ region: 'fsn1' })).toEqual(['integrated:controller']);
  });

  it('parses invalid provisioning option keys safely', () => {
    expect(parseProvisioningOptionKey('')).toBeNull();
    expect(parseProvisioningOptionKey('integrated:invalid')).toBeNull();
    expect(buildProvisioningOptionsFromKeys(['integrated:controller', 'bad-key', 'custom:cfg-1'])).toEqual([
      { type: 'integrated', service: 'controller' },
      { type: 'custom', cloudInitConfigId: 'cfg-1' },
    ]);
  });
});
