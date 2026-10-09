import {
  AGENSTRA_AUTOMATION_AGENT_NAME,
  AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION,
  AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR,
  injectPlatformAutomationConfig,
  parseAgenstraAutomationTurnStatus,
} from './automation-platform';

describe('automation-platform', () => {
  it('exports a positive platform wire version for sync revision hashing', () => {
    expect(AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION).toBeGreaterThan(0);
  });

  it('injects platform agent and skill paths even when overlays omit them', () => {
    const injected = injectPlatformAutomationConfig({
      agents: { build: { mode: 'primary' } },
      skills: ['/opt/skills/local'],
    });

    expect(injected.agents).toMatchObject({
      build: { mode: 'primary' },
      [AGENSTRA_AUTOMATION_AGENT_NAME]: {
        mode: 'primary',
        hidden: true,
        permission: 'allow',
      },
    });
    expect(injected.skills).toEqual({
      paths: ['/opt/skills/local', AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR],
      urls: [],
    });
  });

  it('re-injects platform agent when overlay tried to remove it', () => {
    const injected = injectPlatformAutomationConfig({ agents: {} });

    expect(injected.agents).toHaveProperty(AGENSTRA_AUTOMATION_AGENT_NAME);
  });

  it('preserves project-owned skill paths and URLs without injecting a project copy', () => {
    const injected = injectPlatformAutomationConfig({
      skills: { paths: ['.opencode/skills/project-skill'], urls: ['https://example.com/skills'] },
    });

    expect(injected.skills).toEqual({
      paths: ['.opencode/skills/project-skill', AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR],
      urls: ['https://example.com/skills'],
    });
    expect(injectPlatformAutomationConfig({}).skills).toEqual({
      paths: [AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR],
      urls: [],
    });
  });

  it('parses structured turn status payloads', () => {
    expect(parseAgenstraAutomationTurnStatus({ status: 'complete' })).toBe('complete');
    expect(parseAgenstraAutomationTurnStatus('{"status":"continue"}')).toBe('continue');
    expect(parseAgenstraAutomationTurnStatus({ status: 'nope' })).toBeUndefined();
  });
});
