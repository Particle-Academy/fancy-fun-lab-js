import type { TableName } from "./schema";

/** One stored row. `id` is assigned by the store, 1, 2, 3 per table. */
export type Row = { id: number } & Record<string, unknown>;

/**
 * Where the engine keeps its state. Deliberately narrow: rows in the
 * laravel-fun-lab tables (see `SCHEMA`), equality lookups, and the two
 * primitives correctness depends on.
 *
 * - `compareAndSet` is how a level is claimed EXACTLY ONCE: the row moves from
 *   the level a caller read to the new one only if nobody moved it first. A
 *   store that implements it as read-then-write reintroduces the race the PHP
 *   engine closed in 0.7.0 (metric levels) and 0.8.0 (group levels).
 * - `increment` must be atomic for the same reason: two awards landing together
 *   must both count.
 *
 * Every method is synchronous; both shipped stores are. Rows returned are
 * copies, so mutating one never changes what is stored.
 */
export interface Store {
  /** Insert a row and return it with its new id. */
  insert(table: TableName, values: Record<string, unknown>): Row;
  /** Set columns on one row. */
  update(table: TableName, id: number, values: Record<string, unknown>): void;
  /** One row by id. */
  find(table: TableName, id: number): Row | undefined;
  /** Rows whose columns equal `where` (null matches null), ordered by id. */
  select(table: TableName, where?: Record<string, unknown>): Row[];
  /**
   * Set `values` on the row only if `column` still equals `expected`. Returns
   * whether it did.
   */
  compareAndSet(table: TableName, id: number, column: string, expected: unknown, values: Record<string, unknown>): boolean;
  /** Add `amount` to a numeric column, setting `values` in the same write. */
  increment(table: TableName, id: number, column: string, amount: number, values?: Record<string, unknown>): void;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Equality the way SQL `=` reads a stored value, with a number and its numeric string equal. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") return String(a) === String(b);
  return a === b;
}

/** The reference store: plain objects in memory. The conformance tables run against it and SQLite. */
export class InMemoryStore implements Store {
  private readonly tables = new Map<TableName, Row[]>();
  private readonly ids = new Map<TableName, number>();

  private rows(table: TableName): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  insert(table: TableName, values: Record<string, unknown>): Row {
    const id = (this.ids.get(table) ?? 0) + 1;
    this.ids.set(table, id);
    const row = { ...clone(values), id } as Row;
    this.rows(table).push(row);
    return clone(row);
  }

  update(table: TableName, id: number, values: Record<string, unknown>): void {
    const row = this.rows(table).find((r) => r.id === id);
    if (row) Object.assign(row, clone(values));
  }

  find(table: TableName, id: number): Row | undefined {
    return clone(this.rows(table).find((r) => r.id === id));
  }

  select(table: TableName, where: Record<string, unknown> = {}): Row[] {
    const keys = Object.keys(where);
    return this.rows(table)
      .filter((r) => keys.every((k) => sameValue(r[k], where[k])))
      .map(clone);
  }

  compareAndSet(table: TableName, id: number, column: string, expected: unknown, values: Record<string, unknown>): boolean {
    const row = this.rows(table).find((r) => r.id === id);
    if (!row || !sameValue(row[column], expected)) return false;
    Object.assign(row, clone(values));
    return true;
  }

  increment(table: TableName, id: number, column: string, amount: number, values: Record<string, unknown> = {}): void {
    const row = this.rows(table).find((r) => r.id === id);
    if (!row) return;
    row[column] = Number(row[column] ?? 0) + amount;
    Object.assign(row, clone(values));
  }
}
