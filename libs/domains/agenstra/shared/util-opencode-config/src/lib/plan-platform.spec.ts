import {
  AGENSTRA_CHAT_PLAN_SKILL_ABS_DIR,
  AGENSTRA_CHAT_PLAN_SKILL_REL_DIR,
  AGENSTRA_PLAN_AGENT_NAME,
  AGENSTRA_PLAN_SESSION_PERMISSION_RULESET,
  injectPlatformPlanConfig,
  isAgenstraPlanExplorePermission,
  isAgenstraPlanWritePermission,
  parseAgenstraPlanTurnStatus,
} from './plan-platform';

describe('plan-platform', () => {
  it('injects platform plan agent and skill paths even when overlays omit them', () => {
    const injected = injectPlatformPlanConfig({
      agents: { build: { mode: 'primary' } },
      skills: ['/opt/skills/local'],
    });

    expect(injected.agents).toMatchObject({
      build: { mode: 'primary' },
      [AGENSTRA_PLAN_AGENT_NAME]: {
        mode: 'primary',
        hidden: true,
      },
    });
    expect(injected.skills).toEqual({
      paths: ['/opt/skills/local', AGENSTRA_CHAT_PLAN_SKILL_ABS_DIR, AGENSTRA_CHAT_PLAN_SKILL_REL_DIR],
      urls: [],
    });
  });

  it('session ruleset allows explore tools and denies write tools', () => {
    const byPermission = new Map(
      AGENSTRA_PLAN_SESSION_PERMISSION_RULESET.map((rule) => [rule.permission, rule.action]),
    );

    expect(byPermission.get('read')).toBe('allow');
    expect(byPermission.get('glob')).toBe('allow');
    expect(byPermission.get('grep')).toBe('allow');
    expect(byPermission.get('edit')).toBe('deny');
    expect(byPermission.get('write')).toBe('deny');
    expect(byPermission.get('patch')).toBe('deny');
    expect(byPermission.get('bash')).toBe('deny');
    expect(byPermission.get('*')).toBe('deny');
  });

  it('classifies explore vs write permission residual asks', () => {
    expect(isAgenstraPlanExplorePermission('read')).toBe(true);
    expect(isAgenstraPlanExplorePermission('grep')).toBe(true);
    expect(isAgenstraPlanWritePermission('edit')).toBe(true);
    expect(isAgenstraPlanWritePermission('bash')).toBe(true);
    expect(isAgenstraPlanWritePermission('read')).toBe(false);
    expect(isAgenstraPlanWritePermission('unknown-tool')).toBe(true);
  });

  it('parses structured plan turn status payloads', () => {
    expect(parseAgenstraPlanTurnStatus({ status: 'ready', planMarkdown: '# Plan', summary: 'Done' })).toEqual({
      status: 'ready',
      planMarkdown: '# Plan',
      summary: 'Done',
    });
    expect(parseAgenstraPlanTurnStatus('{"status":"exploring"}')).toEqual({ status: 'exploring' });
    expect(parseAgenstraPlanTurnStatus({ status: 'nope' })).toBeUndefined();
  });
});
