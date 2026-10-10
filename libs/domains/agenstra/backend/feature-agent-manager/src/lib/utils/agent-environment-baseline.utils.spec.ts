import {
  parseAgentEnvironmentBaseline,
  planAgentEnvironmentVariables,
  serializeAgentEnvironmentBaseline,
  shieldAgentEnvironmentVariables,
  withAgentEnvironmentLock,
} from './agent-environment-baseline.utils';

describe('agent-environment-baseline.utils', () => {
  describe('parseAgentEnvironmentBaseline / serializeAgentEnvironmentBaseline', () => {
    it('round-trips a baseline', () => {
      const baseline = { GIT_USERNAME: 'base', TEST: null };

      expect(parseAgentEnvironmentBaseline(serializeAgentEnvironmentBaseline(baseline))).toEqual(baseline);
    });

    it.each([undefined, null, '', 'not json', '[]', '"x"', 'null'])('treats %p as untracked', (raw) => {
      expect(parseAgentEnvironmentBaseline(raw as string | null | undefined)).toBeNull();
    });

    it('drops entries that are neither strings nor null', () => {
      expect(parseAgentEnvironmentBaseline('{"A":"a","B":1,"C":null,"D":{}}')).toEqual({ A: 'a', C: null });
    });
  });

  describe('planAgentEnvironmentVariables', () => {
    it('records replaced values and absent keys for tracked agents', () => {
      const plan = planAgentEnvironmentVariables({
        desired: { GIT_USERNAME: 'agent', NEW_VAR: 'x' },
        baseline: {},
        currentEnv: { GIT_USERNAME: 'base', OTHER: 'o' },
      });

      expect(plan.env).toEqual({ GIT_USERNAME: 'agent', NEW_VAR: 'x' });
      expect(plan.baseline).toEqual({ GIT_USERNAME: 'base', NEW_VAR: null });
    });

    it('keeps existing baseline entries when a variable is updated', () => {
      const plan = planAgentEnvironmentVariables({
        desired: { GIT_USERNAME: 'agent-2' },
        baseline: { GIT_USERNAME: 'base' },
        currentEnv: { GIT_USERNAME: 'agent-1' },
      });

      expect(plan.env).toEqual({ GIT_USERNAME: 'agent-2' });
      expect(plan.baseline).toEqual({ GIT_USERNAME: 'base' });
    });

    it('restores the replaced value or removes the key when a variable is deleted', () => {
      const plan = planAgentEnvironmentVariables({
        desired: {},
        baseline: { GIT_USERNAME: 'base', TEST: null },
        currentEnv: { GIT_USERNAME: 'agent', TEST: 'agent' },
      });

      expect(plan.env).toEqual({ GIT_USERNAME: 'base', TEST: undefined });
      expect('TEST' in plan.env).toBe(true);
      expect(plan.baseline).toEqual({});
    });

    it('handles a rename as removal of the old key and addition of the new one', () => {
      const plan = planAgentEnvironmentVariables({
        desired: { NEW_NAME: 'v' },
        baseline: { OLD_NAME: null },
        currentEnv: { OLD_NAME: 'v' },
      });

      expect(plan.env).toEqual({ NEW_NAME: 'v', OLD_NAME: undefined });
      expect(plan.baseline).toEqual({ NEW_NAME: null });
    });

    it('only trusts hinted additions as base values for untracked agents', () => {
      const plan = planAgentEnvironmentVariables({
        desired: { EXISTING: 'agent', GIT_USERNAME: 'agent' },
        baseline: null,
        currentEnv: { EXISTING: 'agent', GIT_USERNAME: 'base' },
        hints: { addedKeys: ['GIT_USERNAME'] },
      });

      expect(plan.env).toEqual({ EXISTING: 'agent', GIT_USERNAME: 'agent' });
      expect(plan.baseline).toEqual({ EXISTING: null, GIT_USERNAME: 'base' });
    });

    it('removes hinted keys for untracked agents', () => {
      const plan = planAgentEnvironmentVariables({
        desired: { KEEP: 'k' },
        baseline: null,
        currentEnv: { KEEP: 'k', GONE: 'g' },
        hints: { removedKeys: ['GONE', 'KEEP'] },
      });

      expect(plan.env).toEqual({ KEEP: 'k', GONE: undefined });
      expect(plan.baseline).toEqual({ KEEP: null });
    });

    it('ignores removal hints for tracked agents', () => {
      const plan = planAgentEnvironmentVariables({
        desired: {},
        baseline: {},
        currentEnv: { BASE_ONLY: 'b' },
        hints: { removedKeys: ['BASE_ONLY'] },
      });

      expect(plan.env).toEqual({});
    });
  });

  describe('shieldAgentEnvironmentVariables', () => {
    it('passes everything through for untracked agents', () => {
      expect(shieldAgentEnvironmentVariables({ A: 'a', B: undefined }, null)).toEqual({
        env: { A: 'a', B: undefined },
        baseline: null,
        baselineChanged: false,
      });
    });

    it('updates the baseline of keys controlled by agent-level variables instead of the container', () => {
      const result = shieldAgentEnvironmentVariables(
        { GIT_TOKEN: 'rotated', HTTP_PROXY: undefined, OTHER: 'o' },
        { GIT_TOKEN: 'old', HTTP_PROXY: 'http://proxy' },
      );

      expect(result.env).toEqual({ OTHER: 'o' });
      expect(result.baseline).toEqual({ GIT_TOKEN: 'rotated', HTTP_PROXY: null });
      expect(result.baselineChanged).toBe(true);
    });

    it('only touches previously existing keys when requested', () => {
      const result = shieldAgentEnvironmentVariables(
        { AGENT_ONLY: 'override', GIT_TOKEN: 'rotated' },
        { AGENT_ONLY: null, GIT_TOKEN: 'old' },
        { onlyExistingKeys: true },
      );

      expect(result.env).toEqual({});
      expect(result.baseline).toEqual({ AGENT_ONLY: null, GIT_TOKEN: 'rotated' });
    });

    it('reports unchanged baselines', () => {
      expect(shieldAgentEnvironmentVariables({ A: 'a' }, { A: 'a' }).baselineChanged).toBe(false);
    });
  });

  describe('withAgentEnvironmentLock', () => {
    it('serializes tasks per agent and keeps running after a failure', async () => {
      const order: string[] = [];
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const first = withAgentEnvironmentLock('a1', async () => {
        await gate;
        order.push('first');
        throw new Error('boom');
      });
      const second = withAgentEnvironmentLock('a1', async () => {
        order.push('second');

        return 'ok';
      });
      const other = withAgentEnvironmentLock('a2', async () => {
        order.push('other');
      });

      await other;
      release();

      await expect(first).rejects.toThrow('boom');
      await expect(second).resolves.toBe('ok');
      expect(order).toEqual(['other', 'first', 'second']);
    });
  });
});
