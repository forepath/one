import { CorrelationAwareConsoleLogger } from './correlation-aware-console-logger';
import { runWithCorrelationId } from './correlation-id.storage';

describe('CorrelationAwareConsoleLogger', () => {
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  function combinedOutput(): string {
    const out = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
    const err = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    return out + err;
  }

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('prefixes text logs with correlation id when AsyncLocalStorage has a value', () => {
    const logger = new CorrelationAwareConsoleLogger({ colors: false, json: false });
    runWithCorrelationId('req-abc', () => {
      logger.log('hello');
    });
    const output = combinedOutput();
    expect(output).toContain('[corr=req-abc]');
    expect(output).toContain('hello');
  });

  it('omits correlation prefix when outside runWithCorrelationId', () => {
    const logger = new CorrelationAwareConsoleLogger({ colors: false, json: false });
    logger.log('hello');
    const output = combinedOutput();
    expect(output).not.toContain('[corr=');
    expect(output).toContain('hello');
  });

  it('adds correlationId to JSON log objects', () => {
    const logger = new CorrelationAwareConsoleLogger({ json: true, colors: false });
    runWithCorrelationId('json-corr', () => {
      logger.log('hello');
    });
    const line = String(stdoutSpy.mock.calls[0]?.[0] ?? stderrSpy.mock.calls[0]?.[0] ?? '').trim();
    const parsed = JSON.parse(line) as { correlationId?: string; message: string };
    expect(parsed.correlationId).toBe('json-corr');
    expect(parsed.message).toBe('hello');
  });

  it('sanitizes object payloads before logging (text mode)', () => {
    const logger = new CorrelationAwareConsoleLogger({ colors: false, json: false });

    runWithCorrelationId('req-sanitize', () => {
      logger.error({ password: 'super-secret', ok: true, nested: { access_token: 'tok' } });
    });

    const output = combinedOutput();
    expect(output).toContain('[corr=req-sanitize]');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('super-secret');
    expect(output).toContain("access_token: '[REDACTED]'");
    expect(output).not.toContain("access_token: 'tok'");
  });

  it('sanitizes Bearer tokens in string messages', () => {
    const logger = new CorrelationAwareConsoleLogger({ colors: false, json: false });

    runWithCorrelationId('req-bearer', () => {
      logger.warn('Authorization: Bearer abc.def.ghi');
    });

    const output = combinedOutput();
    expect(output).toContain('Bearer [REDACTED]');
    expect(output).not.toContain('abc.def.ghi');
  });

  it('supports constructor overloads (no-arg, context-only, context + options)', () => {
    const def = new CorrelationAwareConsoleLogger();
    const a = new CorrelationAwareConsoleLogger('CtxA');
    const b = new CorrelationAwareConsoleLogger('CtxB', { colors: false, json: false });
    expect(def).toBeInstanceOf(CorrelationAwareConsoleLogger);
    expect(a).toBeInstanceOf(CorrelationAwareConsoleLogger);
    expect(b).toBeInstanceOf(CorrelationAwareConsoleLogger);
    b.log('ok');
    expect(combinedOutput()).toContain('ok');
  });

  it('JSON logs omit correlationId when outside runWithCorrelationId', () => {
    const logger = new CorrelationAwareConsoleLogger({ json: true, colors: false });
    logger.log('orphan');
    const line = String(stdoutSpy.mock.calls[0]?.[0] ?? stderrSpy.mock.calls[0]?.[0] ?? '').trim();
    const parsed = JSON.parse(line) as { correlationId?: string; message: string };
    expect(parsed.message).toBe('orphan');
    expect(parsed.correlationId).toBeUndefined();
  });
});
