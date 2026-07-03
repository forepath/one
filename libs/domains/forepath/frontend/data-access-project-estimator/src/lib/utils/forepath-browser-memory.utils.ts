import {
  FOREPATH_MEMORY_HEADROOM_MAX_HEAP_USAGE,
  FOREPATH_MEMORY_PRESSURE_MESSAGE,
} from '../constants/forepath-llm-memory.constants';

interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export function readBrowserHeapUsageRatio(): number | null {
  if (typeof performance === 'undefined') {
    return null;
  }

  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;

  if (!memory || memory.jsHeapSizeLimit <= 0) {
    return null;
  }

  return memory.usedJSHeapSize / memory.jsHeapSizeLimit;
}

export function hasBrowserMemoryHeadroom(maxHeapUsage = FOREPATH_MEMORY_HEADROOM_MAX_HEAP_USAGE): boolean {
  const heapUsage = readBrowserHeapUsageRatio();

  if (heapUsage === null) {
    return true;
  }

  return heapUsage < maxHeapUsage;
}

export function assertBrowserMemoryHeadroom(): void {
  if (!hasBrowserMemoryHeadroom()) {
    throw new Error(FOREPATH_MEMORY_PRESSURE_MESSAGE);
  }
}
