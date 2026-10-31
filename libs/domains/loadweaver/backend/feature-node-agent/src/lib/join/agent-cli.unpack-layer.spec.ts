import { runAgentCli } from './agent-cli';

describe('loadweaver-agent unpack-layer (internal)', () => {
  afterEach(() => {
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  it('reports a refused layer with its reason only, no stack trace (G5: it ends up in the replica status)', async () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runAgentCli(
      ['unpack-layer', '--staging', 'relative/dir', '--media-type', 'application/vnd.oci.image.layer.v1.tar'].concat([
        '--size',
        '1',
        '--max-bytes',
        '1',
      ]),
      'usage',
    );

    expect(process.exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith('staging must be an absolute path\n');
    expect(stderr.mock.calls.flat().join('')).not.toMatch(/\n\s+at /);
  });
});
