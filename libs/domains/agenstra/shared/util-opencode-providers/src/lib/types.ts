/**
 * Built-in OpenCode LLM provider metadata (from models.dev / API catalog).
 *
 * @see https://models.dev/
 * @see https://opencode.ai/docs/providers/
 */
export interface OpencodeBuiltinProviderModel {
  /** Model id used in OpenCode (`provider/model` pairs use this id). */
  id: string;
  /** Human-readable display name from models.dev. */
  name: string;
}

export interface OpencodeBuiltinProvider {
  /** Provider id used in OpenCode config (`providers.<id>`). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Credential environment variable names recommended by models.dev. */
  env: string[];
  /** Models available for this provider from models.dev (empty for unknown / custom). */
  models: OpencodeBuiltinProviderModel[];
  /** Optional npm package for the provider SDK. */
  npm?: string;
  /** Optional API base URL hint from models.dev. */
  api?: string;
}
