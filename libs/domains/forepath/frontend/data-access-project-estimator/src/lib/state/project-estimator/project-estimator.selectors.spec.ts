import { selectCanSubmit, selectDeviceSupported } from './project-estimator.selectors';

describe('projectEstimatorSelectors', () => {
  it('should detect supported devices', () => {
    expect(selectDeviceSupported.projector('supported')).toBe(true);
    expect(selectDeviceSupported.projector('unsupported')).toBe(false);
  });

  it('should allow submit only when device is ready and model is loaded', () => {
    expect(selectCanSubmit.projector(true, 'ready', false, false)).toBe(true);
    expect(selectCanSubmit.projector(false, 'ready', false, false)).toBe(false);
    expect(selectCanSubmit.projector(true, 'loading', false, false)).toBe(false);
    expect(selectCanSubmit.projector(true, 'ready', true, false)).toBe(false);
    expect(selectCanSubmit.projector(true, 'ready', false, true)).toBe(false);
  });
});
