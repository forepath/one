import { fpcJsonValidator, fpcYamlValidator } from './code-editor.validators';

describe('fpcYamlValidator', () => {
  it('returns no diagnostics for valid YAML without a document validator', () => {
    expect(fpcYamlValidator()('a: 1\nb: [1, 2]\n', 'yaml')).toEqual([]);
  });

  it('reports syntax errors with positions and skips the document validator', () => {
    const validateDocument = jest.fn(() => []);
    const diagnostics = fpcYamlValidator(validateDocument)('a: 1\nb: [1, 2\n', 'yaml');

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]).toEqual(expect.objectContaining({ severity: 'error', line: expect.any(Number) }));
    expect(validateDocument).not.toHaveBeenCalled();
  });

  it('reports duplicate keys', () => {
    const [diagnostic] = fpcYamlValidator()('a: 1\na: 2\n', 'yaml');

    expect(diagnostic).toEqual(expect.objectContaining({ line: 2, column: 1, severity: 'error' }));
  });

  it('positions document issues at the node of their path', () => {
    const text = ['services:', '  web:', '    image: nginx', '    replicas: "3"', ''].join('\n');
    const diagnostics = fpcYamlValidator((doc) => {
      const replicas = (doc as { services: { web: { replicas: unknown } } }).services.web.replicas;

      return typeof replicas === 'number'
        ? []
        : [{ path: ['services', 'web', 'replicas'], message: 'must be integer', severity: 'warning' as const }];
    })(text, 'yaml');

    expect(diagnostics).toEqual([
      {
        line: 4,
        column: 15,
        endLine: 4,
        endColumn: 18,
        message: 'services.web.replicas: must be integer',
        severity: 'warning',
      },
    ]);
  });

  it('falls back to the closest existing ancestor for missing paths', () => {
    const text = 'services:\n  web:\n    image: nginx\n';
    const [diagnostic] = fpcYamlValidator(() => [{ path: ['services', 'web', 'ports'], message: 'is required' }])(
      text,
      'yaml',
    );

    expect(diagnostic).toEqual(
      expect.objectContaining({ line: 3, column: 5, message: 'services.web.ports: is required' }),
    );
  });
});

describe('fpcJsonValidator', () => {
  it('accepts empty and valid JSON', () => {
    expect(fpcJsonValidator()('', 'json')).toEqual([]);
    expect(fpcJsonValidator()('{"a": 1}', 'json')).toEqual([]);
  });

  it('reports syntax errors', () => {
    const [diagnostic] = fpcJsonValidator()('{\n  "a": 1,\n}', 'json');

    expect(diagnostic).toEqual(expect.objectContaining({ severity: 'error', line: expect.any(Number) }));
    expect(diagnostic.line).toBeGreaterThanOrEqual(2);
  });

  it('positions document issues', () => {
    const [diagnostic] = fpcJsonValidator(() => [{ path: ['spec', 'port'], message: 'out of range' }])(
      '{\n  "spec": {\n    "port": 70000\n  }\n}',
      'json',
    );

    expect(diagnostic).toEqual(expect.objectContaining({ line: 3, column: 13, message: 'spec.port: out of range' }));
  });
});
