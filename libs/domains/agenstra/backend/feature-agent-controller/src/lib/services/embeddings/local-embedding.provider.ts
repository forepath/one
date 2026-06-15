import { Injectable } from '@nestjs/common';

export interface LocalEmbeddingResult {
  vector: number[];
}

@Injectable()
export class LocalEmbeddingProvider {
  private readonly dimensions: number;

  constructor() {
    const parsed = parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10);

    this.dimensions = Number.isFinite(parsed) && parsed > 0 ? parsed : 768;
  }

  getModelName(): string {
    return process.env.EMBEDDING_MODEL || 'local-hash-embed-v1';
  }

  getProviderName(): string {
    return 'local';
  }

  async embedMany(texts: string[]): Promise<LocalEmbeddingResult[]> {
    return texts.map((text) => ({ vector: this.embedText(text) }));
  }

  private embedText(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const normalized = text.toLowerCase();

    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.charCodeAt(i);
      const bucket = (code * 31 + i * 17) % this.dimensions;

      vector[bucket] += ((code % 67) + 1) / 67;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

    if (norm === 0) {
      return vector;
    }

    return vector.map((value) => value / norm);
  }
}
