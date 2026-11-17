/**
 * `@particle-academy/fancy-fun-lab/sqlite`: a Store on Node's built-in
 * `node:sqlite` (Node 22.13 or later; it prints an ExperimentalWarning on 22).
 *
 * The tables are laravel-fun-lab's: the same names behind the same prefix
 * (`lfl_` by default), the same columns, datetimes as `Y-m-d H:i:s` in UTC,
 * booleans as 0/1 and JSON as text. So this store can open the SQLite file a
 * Laravel app uses, and a Laravel app can open this one. Tables are created
 * if they do not exist; existing ones are used as they are.
 *
 * This module is the only one that imports `node:sqlite`. The package root
 * never does, so the engine runs anywhere.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { SCHEMA, UNIQUE, type ColumnKind, type TableName } from "./schema";
import type { Row, Store } from "./store";

export interface SqliteStoreOptions {
  /** Table name prefix. Default `lfl_`, as `lfl.table_prefix`. */
  prefix?: string;
  /** Create missing tables. Default true. */
  migrate?: boolean;
}

const SQL_TYPE: Record<ColumnKind, string> = {
  int: "integer",
  decimal: "numeric",
  text: "varchar",
  bool: "tinyint(1)",
  json: "text",
  datetime: "datetime",
};

export class SqliteStore implements Store {
  readonly db: DatabaseSync;
  private readonly prefix: string;

  /**
   * @param database a path, ":memory:", or an open `DatabaseSync` to share
   * (two stores on one file see each other's writes, which is what a
   * compare-and-set is for).
   */
  constructor(database: string | DatabaseSync, options: SqliteStoreOptions = {}) {
    this.db = typeof database === "string" ? new DatabaseSync(database) : database;
    this.prefix = options.prefix ?? "lfl_";
    if (options.migrate ?? true) this.migrate();
  }

  /** Create any missing table (and its unique indexes), with laravel-fun-lab's layout. */
  migrate(): void {
    for (const [table, columns] of Object.entries(SCHEMA) as [TableName, Record<string, ColumnKind>][]) {
      const cols = Object.entries(columns).map(([c, k]) => `"${c}" ${SQL_TYPE[k]}`);
      this.db.exec(`create table if not exists "${this.t(table)}" ("id" integer primary key autoincrement not null, ${cols.join(", ")})`);
      for (const unique of UNIQUE[table] ?? []) {
        const name = `${this.t(table)}_${unique.join("_")}_unique`;
        this.db.exec(
          `create unique index if not exists "${name}" on "${this.t(table)}" (${unique.map((c) => `"${c}"`).join(", ")})`,
        );
      }
    }
  }

  private t(table: TableName): string {
    return `${this.prefix}${table}`;
  }

  private encode(table: TableName, column: string, value: unknown): SQLInputValue {
    if (value === undefined || value === null) return null;
    const kind = SCHEMA[table][column];
    if (kind === "json") return JSON.stringify(value);
    if (kind === "bool" || typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
    return JSON.stringify(value);
  }

  private decode(table: TableName, raw: Record<string, unknown>): Row {
    const kinds = SCHEMA[table];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const kind = kinds[k];
      if (v === null) out[k] = null;
      else if (kind === "json") out[k] = JSON.parse(String(v));
      else if (kind === "bool") out[k] = Number(v) !== 0;
      else if (typeof v === "bigint") out[k] = Number(v);
      else out[k] = v;
    }
    return out as Row;
  }

  insert(table: TableName, values: Record<string, unknown>): Row {
    const cols = Object.keys(values);
    const sql =
      cols.length === 0
        ? `insert into "${this.t(table)}" default values`
        : `insert into "${this.t(table)}" (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map(() => "?").join(", ")})`;
    const result = this.db.prepare(sql).run(...cols.map((c) => this.encode(table, c, values[c])));
    return this.find(table, Number(result.lastInsertRowid))!;
  }

  update(table: TableName, id: number, values: Record<string, unknown>): void {
    const cols = Object.keys(values);
    if (cols.length === 0) return;
    this.db
      .prepare(`update "${this.t(table)}" set ${cols.map((c) => `"${c}" = ?`).join(", ")} where "id" = ?`)
      .run(...cols.map((c) => this.encode(table, c, values[c])), id);
  }

  find(table: TableName, id: number): Row | undefined {
    const raw = this.db.prepare(`select * from "${this.t(table)}" where "id" = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? this.decode(table, raw) : undefined;
  }

  select(table: TableName, where: Record<string, unknown> = {}): Row[] {
    const cols = Object.keys(where);
    const clause = cols.length === 0 ? "" : ` where ${cols.map((c) => `"${c}" is ?`).join(" and ")}`;
    const rows = this.db
      .prepare(`select * from "${this.t(table)}"${clause} order by "id"`)
      .all(...cols.map((c) => this.encode(table, c, where[c]))) as Record<string, unknown>[];
    return rows.map((r) => this.decode(table, r));
  }

  compareAndSet(table: TableName, id: number, column: string, expected: unknown, values: Record<string, unknown>): boolean {
    const cols = Object.keys(values);
    const result = this.db
      .prepare(`update "${this.t(table)}" set ${cols.map((c) => `"${c}" = ?`).join(", ")} where "id" = ? and "${column}" is ?`)
      .run(...cols.map((c) => this.encode(table, c, values[c])), id, this.encode(table, column, expected));
    return Number(result.changes) === 1;
  }

  increment(table: TableName, id: number, column: string, amount: number, values: Record<string, unknown> = {}): void {
    const cols = Object.keys(values);
    const extra = cols.map((c) => `, "${c}" = ?`).join("");
    this.db
      .prepare(`update "${this.t(table)}" set "${column}" = coalesce("${column}", 0) + ?${extra} where "id" = ?`)
      .run(amount, ...cols.map((c) => this.encode(table, c, values[c])), id);
  }

  close(): void {
    this.db.close();
  }
}
