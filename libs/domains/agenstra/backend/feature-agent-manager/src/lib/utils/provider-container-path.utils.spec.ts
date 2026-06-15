import { expandProviderPathTildeInContainer } from './provider-container-path.utils';

describe('expandProviderPathTildeInContainer', () => {
  const containerId = 'abc123';

  it('returns HOME when path is exactly ~', async () => {
    const getHome = jest.fn().mockResolvedValue('/home/agenstra');

    await expect(expandProviderPathTildeInContainer('~', containerId, getHome)).resolves.toBe('/home/agenstra');
    expect(getHome).toHaveBeenCalledWith(containerId);
  });

  it('expands ~/suffix', async () => {
    const getHome = jest.fn().mockResolvedValue('/home/agenstra');

    await expect(expandProviderPathTildeInContainer('~/.cursor', containerId, getHome)).resolves.toBe(
      '/home/agenstra/.cursor',
    );
  });

  it('returns absolute paths unchanged', async () => {
    const getHome = jest.fn();

    await expect(expandProviderPathTildeInContainer('/etc/foo', containerId, getHome)).resolves.toBe('/etc/foo');
    expect(getHome).not.toHaveBeenCalled();
  });
});
