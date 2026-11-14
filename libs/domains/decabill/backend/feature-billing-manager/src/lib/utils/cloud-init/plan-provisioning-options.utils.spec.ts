import { IntegratedProvisioningService } from './integrated-provisioning-service';
import {
  applyResolvedProvisioningSelectionToConfig,
  collectCustomCloudInitConfigIdsFromPlanDefaults,
  correctOverBackfilledProvisioningOptions,
  encodeProvisioningOptionKey,
  migrateLegacyPlanProviderConfigDefaults,
  normalizePlanProviderConfigDefaults,
  parsePlanProvisioningOptions,
  parseProvisioningOptionKey,
  planHasCustomerProvisioningChoice,
  reconcilePlanProviderConfigDefaults,
  resolveOrderProvisioningSelection,
  resolvePlanProvisioningOptions,
} from './plan-provisioning-options.utils';

describe('planProvisioningOptionsUtils', () => {
  describe('parsePlanProvisioningOptions', () => {
    it('reads explicit provisioningOptions only', () => {
      const options = parsePlanProvisioningOptions({
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(options).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
        { type: 'custom', cloudInitConfigId: 'cfg-1' },
      ]);
    });

    it('ignores legacy service and cloudInitConfigId fields', () => {
      expect(
        parsePlanProvisioningOptions({
          service: 'custom',
          cloudInitConfigId: 'cfg-legacy',
        }),
      ).toEqual([]);
      expect(parsePlanProvisioningOptions({ service: IntegratedProvisioningService.AgenstraManager })).toEqual([]);
      expect(parsePlanProvisioningOptions({ cloudInitConfigIds: ['cfg-a', 'cfg-b'] })).toEqual([]);
    });
  });

  describe('migrateLegacyPlanProviderConfigDefaults', () => {
    it('preserves a single legacy integrated controller option', () => {
      const migrated = migrateLegacyPlanProviderConfigDefaults({
        service: IntegratedProvisioningService.AgenstraController,
        region: 'fsn1',
      });

      expect(migrated?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
      ]);
      expect(migrated?.['service']).toBe('agenstra-controller');
      expect(migrated?.['region']).toBe('fsn1');
    });

    it('preserves a single legacy integrated manager option', () => {
      const migrated = migrateLegacyPlanProviderConfigDefaults({
        service: IntegratedProvisioningService.AgenstraManager,
        region: 'fsn1',
      });

      expect(migrated?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
      ]);
      expect(migrated?.['service']).toBe('agenstra-manager');
    });

    it('preserves legacy custom configs without adding integrated options', () => {
      const migrated = migrateLegacyPlanProviderConfigDefaults({
        service: 'custom',
        cloudInitConfigId: 'cfg-legacy',
      });

      expect(migrated?.['provisioningOptions']).toEqual([{ type: 'custom', cloudInitConfigId: 'cfg-legacy' }]);
      expect(migrated?.['service']).toBe('custom');
      expect(migrated?.['cloudInitConfigId']).toBe('cfg-legacy');
    });

    it('skips plans that already have provisioningOptions', () => {
      const defaults = {
        provisioningOptions: [{ type: 'integrated', service: IntegratedProvisioningService.AgenstraManager }],
        service: IntegratedProvisioningService.AgenstraController,
      };

      expect(migrateLegacyPlanProviderConfigDefaults(defaults)).toBe(defaults);
    });
  });

  describe('normalizePlanProviderConfigDefaults', () => {
    it('stores provisioningOptions and clears service for multi-option plans', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        service: 'custom',
        cloudInitConfigId: 'cfg-1',
        region: 'fsn1',
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(normalized?.['provisioningOptions']).toHaveLength(2);
      expect(normalized?.['service']).toBeUndefined();
      expect(normalized?.['cloudInitConfigId']).toBeUndefined();
      expect(normalized?.['region']).toBe('fsn1');
    });

    it('preserves both integrated options on save without collapsing to one', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        region: 'fsn1',
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
        ],
      });

      expect(normalized?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
      ]);
      expect(normalized?.['service']).toBeUndefined();
      expect(normalized?.['region']).toBe('fsn1');
    });

    it('preserves integrated and custom options together on save', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(normalized?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
        { type: 'custom', cloudInitConfigId: 'cfg-1' },
      ]);
      expect(normalized?.['service']).toBeUndefined();
      expect(normalized?.['cloudInitConfigId']).toBeUndefined();
    });

    it('keeps derived single integrated service fields', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        region: 'fsn1',
        provisioningOptions: [{ type: 'integrated', service: IntegratedProvisioningService.AgenstraController }],
      });

      expect(normalized?.['service']).toBe('agenstra-controller');
      expect(normalized?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
      ]);
    });

    it('promotes legacy integrated service into provisioningOptions on save', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        service: IntegratedProvisioningService.AgenstraManager,
        cloudInitConfigId: 'cfg-1',
        region: 'fsn1',
      });

      expect(normalized?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
      ]);
      expect(normalized?.['service']).toBe('agenstra-manager');
      expect(normalized?.['cloudInitConfigId']).toBeUndefined();
      expect(normalized?.['region']).toBe('fsn1');
    });

    it('promotes legacy custom config into provisioningOptions on save', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        service: 'custom',
        cloudInitConfigId: 'cfg-legacy',
        region: 'fsn1',
      });

      expect(normalized?.['provisioningOptions']).toEqual([{ type: 'custom', cloudInitConfigId: 'cfg-legacy' }]);
      expect(normalized?.['service']).toBe('custom');
      expect(normalized?.['cloudInitConfigId']).toBe('cfg-legacy');
    });
  });

  describe('reconcilePlanProviderConfigDefaults', () => {
    it('matches normalize for legacy payloads', () => {
      const defaults = { service: IntegratedProvisioningService.AgenstraManager, region: 'fsn1' };

      expect(reconcilePlanProviderConfigDefaults(defaults)).toEqual(normalizePlanProviderConfigDefaults(defaults));
    });
  });

  describe('resolveOrderProvisioningSelection', () => {
    const multiPlan = {
      provisioningOptions: [
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
        { type: 'custom', cloudInitConfigId: 'cfg-1' },
      ],
    };

    it('requires provisioningOptionKey for multi-option plans without legacy service', () => {
      expect(() => resolveOrderProvisioningSelection(multiPlan, {})).toThrow(
        'provisioningOptionKey is required when the plan offers multiple provisioning options',
      );
    });

    it('accepts legacy requested service when it matches a plan option', () => {
      expect(
        resolveOrderProvisioningSelection(multiPlan, {
          service: IntegratedProvisioningService.AgenstraController,
        }),
      ).toEqual({ service: IntegratedProvisioningService.AgenstraController });
    });

    it('accepts provisioningOptionKey for integrated option', () => {
      expect(
        resolveOrderProvisioningSelection(multiPlan, {
          provisioningOptionKey: encodeProvisioningOptionKey({
            type: 'integrated',
            service: IntegratedProvisioningService.AgenstraController,
          }),
        }),
      ).toEqual({ service: IntegratedProvisioningService.AgenstraController });
    });

    it('accepts provisioningOptionKey for custom option', () => {
      expect(
        resolveOrderProvisioningSelection(multiPlan, {
          provisioningOptionKey: encodeProvisioningOptionKey({ type: 'custom', cloudInitConfigId: 'cfg-1' }),
        }),
      ).toEqual({ service: 'custom', cloudInitConfigId: 'cfg-1' });
    });

    it('rejects option not on plan', () => {
      expect(() =>
        resolveOrderProvisioningSelection(multiPlan, {
          provisioningOptionKey: encodeProvisioningOptionKey({
            type: 'integrated',
            service: IntegratedProvisioningService.AgenstraManager,
          }),
        }),
      ).toThrow('Provisioning option is not available for this plan');
    });

    it('rejects invalid provisioningOptionKey values', () => {
      expect(() =>
        resolveOrderProvisioningSelection(multiPlan, {
          provisioningOptionKey: 'not-a-valid-key',
        }),
      ).toThrow('Invalid provisioning option');
    });

    it('accepts legacy custom service with cloudInitConfigId in requested config', () => {
      expect(
        resolveOrderProvisioningSelection(multiPlan, {
          service: 'custom',
          cloudInitConfigId: 'cfg-1',
        }),
      ).toEqual({ service: 'custom', cloudInitConfigId: 'cfg-1' });
    });

    it('auto-selects when plan has one explicit option', () => {
      expect(
        resolveOrderProvisioningSelection(
          { provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-only' }] },
          {},
        ),
      ).toEqual({ service: 'custom', cloudInitConfigId: 'cfg-only' });
    });

    it('resolves legacy service defaults before migration backfill', () => {
      expect(
        resolveOrderProvisioningSelection(
          { service: IntegratedProvisioningService.AgenstraManager, region: 'fsn1' },
          {},
        ),
      ).toEqual({
        service: IntegratedProvisioningService.AgenstraManager,
      });
      expect(resolvePlanProvisioningOptions({ service: IntegratedProvisioningService.AgenstraManager })).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
      ]);
    });

    it('rejects plans without provisioning options when no legacy defaults exist', () => {
      expect(() => resolveOrderProvisioningSelection({ service: 'custom' }, {})).toThrow(
        'Plan has no provisioning options configured',
      );
    });
  });

  describe('parseProvisioningOptionKey', () => {
    it('returns null for empty or unknown keys', () => {
      expect(parseProvisioningOptionKey('')).toBeNull();
      expect(parseProvisioningOptionKey('   ')).toBeNull();
      expect(parseProvisioningOptionKey('unknown:key')).toBeNull();
      expect(parseProvisioningOptionKey('integrated:invalid')).toBeNull();
      expect(parseProvisioningOptionKey('custom:')).toBeNull();
    });

    it('parses integrated and custom keys', () => {
      expect(parseProvisioningOptionKey('integrated:agenstra-manager')).toEqual({
        type: 'integrated',
        service: IntegratedProvisioningService.AgenstraManager,
      });
      expect(parseProvisioningOptionKey('custom:cfg-1')).toEqual({ type: 'custom', cloudInitConfigId: 'cfg-1' });
    });

    it('maps legacy integrated keys to canonical service ids', () => {
      expect(parseProvisioningOptionKey('integrated:controller')).toEqual({
        type: 'integrated',
        service: IntegratedProvisioningService.AgenstraController,
      });
      expect(parseProvisioningOptionKey('integrated:manager')).toEqual({
        type: 'integrated',
        service: IntegratedProvisioningService.AgenstraManager,
      });
    });
  });

  describe('resolvePlanProvisioningOptions', () => {
    it('defaults to controller when no explicit or legacy options exist', () => {
      expect(resolvePlanProvisioningOptions({ region: 'fsn1' })).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
      ]);
    });

    it('collects legacy cloudInitConfigIds array', () => {
      expect(
        resolvePlanProvisioningOptions({
          cloudInitConfigIds: ['cfg-a', ' cfg-b ', 42],
        }),
      ).toEqual([
        { type: 'custom', cloudInitConfigId: 'cfg-a' },
        { type: 'custom', cloudInitConfigId: 'cfg-b' },
      ]);
    });

    it('dedupes explicit provisioning options', () => {
      expect(
        parsePlanProvisioningOptions({
          provisioningOptions: [
            { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
            { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
            { type: 'integrated', service: 'invalid' },
            null,
          ],
        }),
      ).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
        { type: 'custom', cloudInitConfigId: 'cfg-1' },
      ]);
    });
  });

  describe('correctOverBackfilledProvisioningOptions', () => {
    it('collapses dual integrated backfill to legacy manager service', () => {
      const corrected = correctOverBackfilledProvisioningOptions({
        service: IntegratedProvisioningService.AgenstraManager,
        region: 'fsn1',
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
        ],
      });

      expect(corrected?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
      ]);
      expect(corrected?.['service']).toBe('agenstra-manager');
    });

    it('keeps custom options when dual integrated backfill included custom configs', () => {
      const corrected = correctOverBackfilledProvisioningOptions({
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(corrected?.['provisioningOptions']).toEqual([{ type: 'custom', cloudInitConfigId: 'cfg-1' }]);
      expect(corrected?.['service']).toBe('custom');
      expect(corrected?.['cloudInitConfigId']).toBe('cfg-1');
    });

    it('returns undefined when no corrective action is needed', () => {
      expect(
        correctOverBackfilledProvisioningOptions({
          provisioningOptions: [{ type: 'integrated', service: IntegratedProvisioningService.AgenstraManager }],
          service: IntegratedProvisioningService.AgenstraManager,
        }),
      ).toBeUndefined();
    });

    it('collapses ambiguous dual integrated backfill to controller when service was cleared', () => {
      const corrected = correctOverBackfilledProvisioningOptions({
        region: 'fsn1',
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
        ],
      });

      expect(corrected?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
      ]);
      expect(corrected?.['service']).toBe('agenstra-controller');
    });
  });

  describe('helpers', () => {
    it('encodes and parses option keys', () => {
      const key = encodeProvisioningOptionKey({ type: 'custom', cloudInitConfigId: 'cfg-1' });

      expect(parseProvisioningOptionKey(key)).toEqual({ type: 'custom', cloudInitConfigId: 'cfg-1' });
    });

    it('detects customer choice plans', () => {
      expect(
        planHasCustomerProvisioningChoice({
          provisioningOptions: [
            { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
          ],
        }),
      ).toBe(true);
      expect(
        planHasCustomerProvisioningChoice({
          provisioningOptions: [{ type: 'integrated', service: IntegratedProvisioningService.AgenstraController }],
        }),
      ).toBe(false);
    });

    it('collects custom config ids from plan defaults', () => {
      expect(
        collectCustomCloudInitConfigIdsFromPlanDefaults({
          provisioningOptions: [
            { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
            { type: 'custom', cloudInitConfigId: 'cfg-2' },
          ],
        }),
      ).toEqual(['cfg-1', 'cfg-2']);
    });

    it('applies resolved selection to effective config', () => {
      const effectiveConfig: Record<string, unknown> = {
        provisioningOptions: [{ type: 'integrated', service: IntegratedProvisioningService.AgenstraController }],
        provisioningOptionKey: 'integrated:agenstra-controller',
        region: 'fsn1',
      };

      applyResolvedProvisioningSelectionToConfig(effectiveConfig, {
        service: 'custom',
        cloudInitConfigId: 'cfg-1',
      });

      expect(effectiveConfig).toEqual({
        region: 'fsn1',
        service: 'custom',
        cloudInitConfigId: 'cfg-1',
      });
    });
  });

  describe('no provisioning option (bare server)', () => {
    it('encodes and parses the none option key', () => {
      expect(encodeProvisioningOptionKey({ type: 'none' })).toBe('none');
      expect(parseProvisioningOptionKey('none')).toEqual({ type: 'none' });
      expect(parseProvisioningOptionKey(' none ')).toEqual({ type: 'none' });
      expect(parseProvisioningOptionKey('none:extra')).toBeNull();
    });

    it('reads explicit none entries and dedupes them', () => {
      expect(
        parsePlanProvisioningOptions({
          provisioningOptions: [{ type: 'none' }, { type: 'none' }, { type: 'custom', cloudInitConfigId: 'cfg-1' }],
        }),
      ).toEqual([{ type: 'none' }, { type: 'custom', cloudInitConfigId: 'cfg-1' }]);
    });

    it('normalizes a none-only plan without falling back to agenstra-controller', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        provisioningOptions: [{ type: 'none' }],
        cloudInitConfigId: 'stale',
      });

      expect(normalized).toEqual({ provisioningOptions: [{ type: 'none' }], service: 'none' });
      expect(resolvePlanProvisioningOptions(normalized)).toEqual([{ type: 'none' }]);
    });

    it('infers none from legacy service when explicit options are absent', () => {
      expect(resolvePlanProvisioningOptions({ service: 'none' })).toEqual([{ type: 'none' }]);
    });

    it('resolves a none-only plan regardless of the customer requested service', () => {
      const defaults = { provisioningOptions: [{ type: 'none' }] };

      expect(resolveOrderProvisioningSelection(defaults, {})).toEqual({ service: 'none' });
      expect(
        resolveOrderProvisioningSelection(defaults, { service: IntegratedProvisioningService.AgenstraController }),
      ).toEqual({ service: 'none' });
    });

    it('lets customers pick none only when the plan offers it', () => {
      const withNone = {
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'none' },
        ],
      };
      const withoutNone = {
        provisioningOptions: [
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraController },
          { type: 'integrated', service: IntegratedProvisioningService.AgenstraManager },
        ],
      };

      expect(resolveOrderProvisioningSelection(withNone, { provisioningOptionKey: 'none' })).toEqual({
        service: 'none',
      });
      expect(resolveOrderProvisioningSelection(withNone, { service: 'none' })).toEqual({ service: 'none' });
      expect(() => resolveOrderProvisioningSelection(withoutNone, { provisioningOptionKey: 'none' })).toThrow(
        'Provisioning option is not available for this plan',
      );
      expect(() => resolveOrderProvisioningSelection(withoutNone, { service: 'none' })).toThrow(
        'provisioningOptionKey is required when the plan offers multiple provisioning options',
      );
    });

    it('does not let a none-only plan be steered to an integrated stack or custom template', () => {
      const defaults = { provisioningOptions: [{ type: 'none' }] };

      expect(() =>
        resolveOrderProvisioningSelection(defaults, { provisioningOptionKey: 'integrated:agenstra-controller' }),
      ).toThrow('Provisioning option is not available for this plan');
      expect(() => resolveOrderProvisioningSelection(defaults, { provisioningOptionKey: 'custom:cfg-1' })).toThrow(
        'Provisioning option is not available for this plan',
      );
    });

    it('applies the none selection and strips custom template references', () => {
      const config: Record<string, unknown> = {
        service: IntegratedProvisioningService.AgenstraController,
        cloudInitConfigId: 'cfg-1',
        provisioningOptions: [{ type: 'none' }],
        provisioningOptionKey: 'none',
      };

      applyResolvedProvisioningSelectionToConfig(config, { service: 'none' });

      expect(config).toEqual({ service: 'none' });
    });

    it('is neither integrated nor a custom config reference', () => {
      const defaults = { provisioningOptions: [{ type: 'none' }] };

      expect(collectCustomCloudInitConfigIdsFromPlanDefaults(defaults)).toEqual([]);
      expect(planHasCustomerProvisioningChoice(defaults)).toBe(false);
    });
  });
});
