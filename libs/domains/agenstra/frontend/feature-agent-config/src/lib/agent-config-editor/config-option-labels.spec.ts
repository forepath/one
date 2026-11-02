import '@angular/localize/init';
import {
  agentConfigAgentModeLabel,
  agentConfigDefaultOptionLabel,
  agentConfigShareLabel,
  agentConfigUpdateLabel,
} from './config-option-labels';

describe('agent config option labels', () => {
  it('labels the empty option as the inherited default', () => {
    expect(agentConfigDefaultOptionLabel()).toBe('Default (inherited)');
  });

  it('shows words instead of raw option values', () => {
    expect(agentConfigShareLabel('auto')).toBe('Automatic');
    expect(agentConfigUpdateLabel('true')).toBe('Install automatically');
    expect(agentConfigUpdateLabel('notify')).toBe('Notify only');
    expect(agentConfigAgentModeLabel('subagent')).toBe('Subagent only');
  });

  it('keeps unknown values readable as they are', () => {
    expect(agentConfigShareLabel('custom')).toBe('custom');
    expect(agentConfigUpdateLabel('weekly')).toBe('weekly');
    expect(agentConfigAgentModeLabel('other')).toBe('other');
  });
});
