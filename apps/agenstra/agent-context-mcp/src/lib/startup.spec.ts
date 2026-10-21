import { ContextApiError } from './context-api.client';
import { waitForContextApi } from './startup';

describe('waitForContextApi', () => {
  const sleep = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => sleep.mockClear());

  it('resolves once the health probe succeeds', async () => {
    const health = jest.fn().mockRejectedValueOnce(new ContextApiError('down')).mockResolvedValue(undefined);

    await expect(waitForContextApi({ health }, 3, 10, sleep)).resolves.toBeUndefined();
    expect(health).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured attempts', async () => {
    const health = jest.fn().mockRejectedValue(new ContextApiError('down'));

    await expect(waitForContextApi({ health }, 3, 10, sleep)).rejects.toThrow('down');
    expect(health).toHaveBeenCalledTimes(3);
  });

  it('does not retry authentication failures', async () => {
    const health = jest.fn().mockRejectedValue(new ContextApiError('Invalid agent context credentials', 401));

    await expect(waitForContextApi({ health }, 3, 10, sleep)).rejects.toThrow('Invalid agent context credentials');
    expect(health).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
