/** Subset of a Docker image pull progress event (`docker.modem.followProgress` onProgress payload). */
export interface DockerPullProgressEvent {
  id?: string;
  status?: string;
  progressDetail?: {
    current?: number;
    total?: number;
  };
}

interface LayerProgress {
  total: number;
  downloaded: number;
  extracted: number;
  done: boolean;
}

/** Share of a layer's progress attributed to downloading (rest is extraction). */
const DOWNLOAD_WEIGHT = 0.7;

/**
 * Aggregates per-layer Docker pull events into an overall fraction (0..1).
 * Layers without a known size only count once completed, so the fraction is a lower bound.
 */
export class DockerPullProgressAggregator {
  private readonly layers = new Map<string, LayerProgress>();
  private lastFraction = 0;

  /**
   * Apply one pull event.
   * @returns the new overall fraction when it increased, otherwise null
   */
  apply(event: DockerPullProgressEvent): number | null {
    const id = event.id;
    const status = (event.status ?? '').toLowerCase();

    if (!id || !status) {
      return null;
    }

    const layer = this.layers.get(id) ?? { total: 0, downloaded: 0, extracted: 0, done: false };
    const current = event.progressDetail?.current ?? 0;
    const total = event.progressDetail?.total ?? 0;

    if (status.startsWith('downloading')) {
      if (total > 0) {
        layer.total = Math.max(layer.total, total);
      }

      layer.downloaded = Math.max(layer.downloaded, current);
    } else if (status.startsWith('download complete') || status.startsWith('verifying checksum')) {
      layer.downloaded = layer.total;
    } else if (status.startsWith('extracting')) {
      if (total > 0) {
        layer.total = Math.max(layer.total, total);
      }

      layer.downloaded = layer.total;
      layer.extracted = Math.max(layer.extracted, current);
    } else if (status.startsWith('pull complete') || status.startsWith('already exists')) {
      layer.downloaded = layer.total;
      layer.extracted = layer.total;
      layer.done = true;
    }

    this.layers.set(id, layer);

    const fraction = this.computeFraction();

    if (fraction <= this.lastFraction) {
      return null;
    }

    this.lastFraction = fraction;

    return fraction;
  }

  private computeFraction(): number {
    let sized = 0;
    let sizedDone = 0;
    let unsizedLayers = 0;
    let unsizedDone = 0;

    for (const layer of this.layers.values()) {
      if (layer.total > 0) {
        const downloaded = Math.min(layer.downloaded, layer.total) / layer.total;
        const extracted = Math.min(layer.extracted, layer.total) / layer.total;
        const layerFraction = layer.done ? 1 : downloaded * DOWNLOAD_WEIGHT + extracted * (1 - DOWNLOAD_WEIGHT);

        sized += 1;
        sizedDone += layerFraction;
      } else {
        unsizedLayers += 1;
        unsizedDone += layer.done ? 1 : 0;
      }
    }

    const count = sized + unsizedLayers;

    if (count === 0) {
      return 0;
    }

    return Math.min(1, (sizedDone + unsizedDone) / count);
  }
}
