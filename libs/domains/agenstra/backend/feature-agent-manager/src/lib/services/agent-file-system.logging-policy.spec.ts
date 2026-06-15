import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression guard: file payloads (base64 body, buffers, decoded text) must never be written to logs.
 * See `thread-analysis.md` / agent file system threat section.
 */
describe('AgentFileSystemService logging policy (regression)', () => {
  const servicePath = path.join(__dirname, 'agent-file-system.service.ts');
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(servicePath, 'utf8').replace(/\r\n/g, '\n');
  });

  it('does not interpolate file payload bindings into this.logger calls', () => {
    const loggerThenPayloadInterpolation = new RegExp(
      String.raw`this\.logger\.(?:log|debug|warn|error)\s*\([\s\S]*?\$\{(?:content|base64Content|fileBuffer|textContent)\}`,
    );

    expect(source).not.toMatch(loggerThenPayloadInterpolation);
  });

  it('does not pass file payload fields as logger context objects', () => {
    expect(source).not.toMatch(
      /this\.logger\.(?:log|debug|warn|error)\s*\(\s*[^,]+,\s*\{[^}]*\b(?:content|base64Content|fileBuffer)\s*:/,
    );
  });
});
