export interface EmbeddingResult {
  vector: number[];
}

export interface EmbeddingProvider {
  getType(): string;
  getModelName(): string;
  embedMany(texts: string[]): Promise<EmbeddingResult[]>;
}
