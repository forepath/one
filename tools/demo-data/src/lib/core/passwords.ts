import * as bcrypt from 'bcrypt';

/**
 * Hashes with bcrypt like the identity services do. Hashes are cached per (plaintext, rounds)
 * because demo users share passwords and bcrypt at cost 12 is deliberately slow.
 */
export class PasswordHasher {
  private readonly cache = new Map<string, Promise<string>>();

  hash(plain: string, rounds = 12): Promise<string> {
    const cacheKey = `${rounds}:${plain}`;
    let pending = this.cache.get(cacheKey);

    if (!pending) {
      pending = bcrypt.hash(plain, rounds);
      this.cache.set(cacheKey, pending);
    }

    return pending;
  }
}
