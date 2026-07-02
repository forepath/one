import { evaluateDeviceCapability } from './forepath-device-capability.utils';

describe('evaluateDeviceCapability', () => {
  it('should select the lite profile for low-memory devices', () => {
    const result = evaluateDeviceCapability(
      {
        hardwareConcurrency: 8,
        deviceMemory: 4,
      } as Navigator,
      true,
    );

    expect(result.supported).toBe(true);
    expect(result.memoryProfile?.profileId).toBe('lite');
  });

  it('should reject devices below the minimum memory threshold', () => {
    const result = evaluateDeviceCapability(
      {
        hardwareConcurrency: 8,
        deviceMemory: 2,
      } as Navigator,
      true,
    );

    expect(result.supported).toBe(false);
    expect(result.memoryProfile).toBeNull();
  });
});
