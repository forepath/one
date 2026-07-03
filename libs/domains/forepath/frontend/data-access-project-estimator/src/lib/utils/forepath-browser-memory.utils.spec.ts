import {
  assertBrowserMemoryHeadroom,
  hasBrowserMemoryHeadroom,
  readBrowserHeapUsageRatio,
} from './forepath-browser-memory.utils';

describe('forepath browser memory utils', () => {
  const originalPerformance = globalThis.performance;

  afterEach(() => {
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: originalPerformance,
    });
  });

  it('should allow inference when heap usage is unknown', () => {
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: {},
    });

    expect(readBrowserHeapUsageRatio()).toBeNull();
    expect(hasBrowserMemoryHeadroom()).toBe(true);
  });

  it('should reject when heap usage is too high', () => {
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: {
        memory: {
          usedJSHeapSize: 900,
          jsHeapSizeLimit: 1000,
        },
      },
    });

    expect(hasBrowserMemoryHeadroom()).toBe(false);
    expect(() => assertBrowserMemoryHeadroom()).toThrow('low on memory');
  });
});
