import { DockerPullProgressAggregator } from './docker-pull-progress.utils';

describe('DockerPullProgressAggregator', () => {
  it('should ignore events without layer id or status', () => {
    const aggregator = new DockerPullProgressAggregator();

    expect(aggregator.apply({ status: 'Pulling from library/node' })).toBeNull();
    expect(aggregator.apply({ id: 'layer' })).toBeNull();
  });

  it('should weight download and extraction progress per layer', () => {
    const aggregator = new DockerPullProgressAggregator();

    expect(aggregator.apply({ id: 'a', status: 'Pulling fs layer' })).toBeNull();
    expect(
      aggregator.apply({ id: 'a', status: 'Downloading', progressDetail: { current: 50, total: 100 } }),
    ).toBeCloseTo(0.35);
    expect(aggregator.apply({ id: 'a', status: 'Download complete' })).toBeCloseTo(0.7);
    expect(
      aggregator.apply({ id: 'a', status: 'Extracting', progressDetail: { current: 50, total: 100 } }),
    ).toBeCloseTo(0.85);
    expect(aggregator.apply({ id: 'a', status: 'Pull complete' })).toBeCloseTo(1);
  });

  it('should average across layers and count unsized layers once complete', () => {
    const aggregator = new DockerPullProgressAggregator();

    aggregator.apply({ id: 'a', status: 'Pulling fs layer' });
    aggregator.apply({ id: 'b', status: 'Pulling fs layer' });

    expect(aggregator.apply({ id: 'b', status: 'Already exists' })).toBeCloseTo(0.5);
    expect(
      aggregator.apply({ id: 'a', status: 'Downloading', progressDetail: { current: 100, total: 100 } }),
    ).toBeCloseTo(0.85);
  });

  it('should only report increasing fractions', () => {
    const aggregator = new DockerPullProgressAggregator();

    aggregator.apply({ id: 'a', status: 'Downloading', progressDetail: { current: 60, total: 100 } });

    expect(
      aggregator.apply({ id: 'a', status: 'Downloading', progressDetail: { current: 30, total: 100 } }),
    ).toBeNull();
    // A newly discovered layer lowers the average; that must not be reported as a regression.
    expect(aggregator.apply({ id: 'b', status: 'Pulling fs layer' })).toBeNull();
  });
});
