import { main } from './main';

describe('terraform-provider-loadweaver entry point', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('prints its version', async () => {
    await expect(main(['--version'])).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith(expect.stringMatching(/^terraform-provider-loadweaver \S+\n$/));
  });

  it('explains that Terraform starts it when run by hand', async () => {
    delete process.env['TF_PLUGIN_MAGIC_COOKIE'];

    await expect(main([])).resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('This binary is a plugin'));
    expect(stdout).not.toHaveBeenCalled();
  });
});
