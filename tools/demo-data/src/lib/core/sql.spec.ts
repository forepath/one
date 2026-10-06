import { buildInsert, json, raw, SqlScript, toSqlLiteral } from './sql';

describe('toSqlLiteral', () => {
  it('should escape single quotes in strings', () => {
    expect(toSqlLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it('should encode null, booleans and numbers', () => {
    expect(toSqlLiteral(null)).toBe('NULL');
    expect(toSqlLiteral(true)).toBe('TRUE');
    expect(toSqlLiteral(12.5)).toBe('12.5');
  });

  it('should encode dates as ISO strings', () => {
    expect(toSqlLiteral(new Date('2026-01-02T03:04:05.000Z'))).toBe("'2026-01-02T03:04:05.000Z'");
  });

  it('should encode json values as jsonb', () => {
    expect(toSqlLiteral(json({ name: "it's" }))).toBe(`'{"name":"it''s"}'::jsonb`);
  });

  it('should inline raw expressions', () => {
    expect(toSqlLiteral(raw('now()'))).toBe('now()');
  });

  it('should reject non-finite numbers', () => {
    expect(() => toSqlLiteral(Number.NaN)).toThrow('non-finite');
  });
});

describe('buildInsert', () => {
  it('should use the union of columns and DEFAULT for missing values', () => {
    const [statement] = buildInsert('users', [{ id: 'a', email: 'x@example.com' }, { id: 'b' }]);

    expect(statement).toBe(`INSERT INTO "users" ("id", "email") VALUES\n  ('a', 'x@example.com'),\n  ('b', DEFAULT);`);
  });

  it('should split rows into chunks and append conflict clauses', () => {
    const statements = buildInsert('t', [{ id: 1 }, { id: 2 }, { id: 3 }], {
      chunkSize: 2,
      onConflict: 'ON CONFLICT DO NOTHING',
    });

    expect(statements).toHaveLength(2);
    expect(statements[1]).toBe('INSERT INTO "t" ("id") VALUES\n  (3)\nON CONFLICT DO NOTHING;');
  });

  it('should return no statements for empty input', () => {
    expect(buildInsert('t', [])).toEqual([]);
  });
});

describe('SqlScript', () => {
  it('should terminate statements and join them', () => {
    const script = new SqlScript().add('SELECT 1').comment('note').add('SELECT 2;');

    expect(script.toString()).toBe('SELECT 1;\n\n-- note\nSELECT 2;\n');
  });
});
