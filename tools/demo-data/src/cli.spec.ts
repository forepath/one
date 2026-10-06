import { parseCliArgs } from './cli';

describe('parseCliArgs', () => {
  it('should default to all products', () => {
    expect(parseCliArgs(['seed'])).toMatchObject({ command: 'seed', products: ['decabill', 'agenstra'] });
  });

  it('should accept a single product and options', () => {
    expect(parseCliArgs(['reset', 'decabill', '--seed', '7', '--dry-run', '--sql-out', 'tmp/sql'])).toEqual({
      command: 'reset',
      products: ['decabill'],
      seed: 7,
      dryRun: true,
      sqlOutDir: 'tmp/sql',
    });
  });

  it('should reject unknown commands, products and options', () => {
    expect(() => parseCliArgs(['drop'])).toThrow('Unknown command');
    expect(() => parseCliArgs(['seed', 'other'])).toThrow('Unknown product');
    expect(() => parseCliArgs(['seed', '--force'])).toThrow('Unknown option');
    expect(() => parseCliArgs(['seed', '--seed', 'abc'])).toThrow('integer');
  });
});
