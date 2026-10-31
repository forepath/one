import { FindOperator } from 'typeorm';

/**
 * A tiny in-memory stand-in for the TypeORM calls `MasterKeyService` / `BuiltinMemberService` make (tests only):
 * equality and `Not()` in `where`, primary keys per entity for `insert … orIgnore`.
 */
type Row = Record<string, unknown>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;

  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'not') return row[key] !== expected.value;

      throw new Error(`unsupported operator ${expected.type}`);
    }

    return row[key] === expected;
  });
}

export class FakeRepository {
  constructor(
    readonly rows: Row[],
    private readonly keys: string[],
  ) {}

  create(data: Row): Row {
    return { ...data };
  }

  async find(options: { where?: Row; order?: Record<string, 'ASC' | 'DESC'> } = {}): Promise<Row[]> {
    const found = this.rows.filter((r) => matches(r, options.where)).map((r) => structuredClone(r));
    const [orderKey] = Object.keys(options.order ?? {});

    return orderKey ? found.sort((a, b) => String(a[orderKey]).localeCompare(String(b[orderKey]))) : found;
  }

  async findOne(options: { where?: Row }): Promise<Row | null> {
    return (await this.find(options))[0] ?? null;
  }

  async exists(options: { where?: Row }): Promise<boolean> {
    return (await this.find(options)).length > 0;
  }

  private same(a: Row, b: Row): boolean {
    return this.keys.every((k) => a[k] === b[k]);
  }

  async save(row: Row): Promise<Row> {
    const existing = this.rows.find((r) => this.same(r, row));

    if (existing) Object.assign(existing, structuredClone(row));
    else this.rows.push({ createdAt: new Date(), ...structuredClone(row) });

    return row;
  }

  async insert(row: Row, ignore = false): Promise<void> {
    if (this.rows.some((r) => this.same(r, row))) {
      if (ignore) return;

      throw new Error('duplicate key');
    }

    this.rows.push({ createdAt: new Date(), ...structuredClone(row) });
  }

  async update(where: Row, patch: Row): Promise<void> {
    for (const row of this.rows.filter((r) => matches(r, where))) Object.assign(row, structuredClone(patch));
  }

  async delete(where: Row): Promise<void> {
    for (const row of this.rows.filter((r) => matches(r, where))) this.rows.splice(this.rows.indexOf(row), 1);
  }

  createQueryBuilder() {
    let values: Row = {};
    let ignore = false;
    const builder = {
      insert: () => builder,
      values: (v: Row) => ((values = v), builder),
      orIgnore: () => ((ignore = true), builder),
      execute: async () => await this.insert(values, ignore),
    };

    return builder;
  }
}

/** Tables keyed by entity class name. */
export class FakeDataSource {
  readonly tables = new Map<string, FakeRepository>();
  readonly manager = this;

  constructor(private readonly keys: Record<string, string[]>) {}

  getRepository(entity: { name: string }): FakeRepository {
    let repo = this.tables.get(entity.name);

    if (!repo) {
      repo = new FakeRepository([], this.keys[entity.name] ?? ['id']);
      this.tables.set(entity.name, repo);
    }

    return repo;
  }

  rows(entity: { name: string }): Row[] {
    return this.getRepository(entity).rows;
  }

  async query(): Promise<unknown[]> {
    return [];
  }

  async transaction<T>(fn: (manager: FakeDataSource) => Promise<T>): Promise<T> {
    return await fn(this);
  }
}

export const FAKE_KEYS: Record<string, string[]> = {
  MasterKeyEntity: ['id'],
  NodeEntity: ['name'],
  BuiltinMemberEntity: ['id'],
  UnsealRequestEntity: ['id'],
  UnsealShareEntity: ['requestId', 'node'],
  SecretEntity: ['id'],
  GitSopsKeyEntity: ['id'],
  BackupKeyEntity: ['generation'],
};
