import { hashStringToSeed, normalizeProjectDescription } from './forepath-prompt-hash.utils';

describe('forepath prompt hash utils', () => {
  it('should normalize whitespace and casing', () => {
    expect(normalizeProjectDescription('  Build   a   Portal \n')).toBe('build a portal');
  });

  it('should return the same seed for the same normalized prompt', () => {
    const first = hashStringToSeed(normalizeProjectDescription('Build a portal'));
    const second = hashStringToSeed(normalizeProjectDescription('  build   a portal '));

    expect(first).toBe(second);
  });
});
