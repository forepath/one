import {
  buildClientToolsPromptSection,
  CLIENT_TOOL_LIMITS,
  ClientToolsValidationError,
  normalizeClientToolChoice,
  normalizeClientTools,
  serializeClientToolArguments,
} from './client-tools-platform';

describe('client tools platform', () => {
  const tool = { name: 'get_weather', description: 'Weather', parameters: { type: 'object' } };

  it('normalizes valid definitions', () => {
    expect(normalizeClientTools([{ ...tool, strict: true, extra: 'dropped' }])).toEqual([{ ...tool, strict: true }]);
    expect(normalizeClientTools([{ name: 'x', description: null, parameters: null }])).toEqual([{ name: 'x' }]);
  });

  it.each([
    ['a non-array', {}, 'tools'],
    ['a non-object entry', ['x'], 'tools[0]'],
    ['a bad name', [{ name: 'a b' }], 'tools[0].name'],
    ['a long name', [{ name: 'a'.repeat(65) }], 'tools[0].name'],
    ['duplicates', [tool, tool], 'tools[1].name'],
    [
      'a long description',
      [{ name: 'x', description: 'd'.repeat(CLIENT_TOOL_LIMITS.descriptionMaxLength + 1) }],
      'tools[0].description',
    ],
    ['array parameters', [{ name: 'x', parameters: [] }], 'tools[0].parameters'],
    [
      'huge parameters',
      [{ name: 'x', parameters: { d: 'x'.repeat(CLIENT_TOOL_LIMITS.parametersMaxBytes) } }],
      'tools[0].parameters',
    ],
    ['too many tools', Array.from({ length: CLIENT_TOOL_LIMITS.maxTools + 1 }, (_, i) => ({ name: `t${i}` })), 'tools'],
  ])('rejects %s', (_label, raw, param) => {
    try {
      normalizeClientTools(raw);
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(ClientToolsValidationError);
      expect((error as ClientToolsValidationError).param).toBe(param);
    }
  });

  it('bounds the total size of all definitions', () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ name: `t${i}`, parameters: { d: 'x'.repeat(15_000) } }));

    expect(() => normalizeClientTools(big)).toThrow(ClientToolsValidationError);
  });

  it('normalizes tool choices', () => {
    expect(normalizeClientToolChoice(undefined, [tool])).toBe('auto');
    expect(normalizeClientToolChoice('required', [tool])).toBe('required');
    expect(normalizeClientToolChoice({ name: 'get_weather' }, [tool])).toEqual({ name: 'get_weather' });
    expect(() => normalizeClientToolChoice({ name: 'nope' }, [tool])).toThrow(ClientToolsValidationError);
    expect(() => normalizeClientToolChoice('sometimes', [tool])).toThrow(ClientToolsValidationError);
  });

  it('serializes arguments to a canonical JSON object', () => {
    expect(serializeClientToolArguments({ a: 1 })).toBe('{"a":1}');
    expect(serializeClientToolArguments(' {"a": 1} ')).toBe('{"a":1}');
    expect(serializeClientToolArguments(undefined)).toBe('{}');
    expect(serializeClientToolArguments('')).toBe('{}');

    for (const bad of ['[1]', 'not json', [1], 5]) {
      expect(() => serializeClientToolArguments(bad)).toThrow(ClientToolsValidationError);
    }
  });

  it('describes the tools, choice and parallelism in the prompt section', () => {
    const section = buildClientToolsPromptSection('ctx-ticket', [tool, { name: 'bare' }], {
      choice: { name: 'get_weather' },
      parallel: false,
    });

    expect(section).toContain('ticket: "ctx-ticket"');
    expect(section).toContain('agenstra_client_tools_call');
    expect(section).toContain('agenstra_client_tools_result');
    expect(section).toContain('- get_weather: Weather');
    expect(section).toContain('parameters: {"type":"object"}');
    expect(section).toContain('- bare\n  parameters: {"type":"object","properties":{}}');
    expect(section).toContain('You must call the client tool "get_weather" before you answer.');
    expect(section).toContain('Call at most one client tool at a time.');
    expect(buildClientToolsPromptSection('t', [tool])).not.toContain('at most one');
  });
});
