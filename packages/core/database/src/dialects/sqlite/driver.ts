import type { Knex } from 'knex';

/**
 * Pluggable SQLite drivers.
 *
 * Knex's sqlite dialect only touches its driver in three places: opening a
 * connection, running a statement, and closing it. Everything else (SQL
 * generation, schema builder, response processing) is driver-agnostic. Swapping
 * those three lets Strapi run on SQLite engines that are not the native
 * `better-sqlite3` addon: `node:sqlite` in Node and Deno, or a platform binding.
 */

export interface SqliteResult {
  /** True when the statement returns rows (SELECT, PRAGMA, ... RETURNING). */
  reader: boolean;
  rows: Record<string, unknown>[];
  lastID?: number;
  changes?: number;
}

export interface SqliteConnection {
  query(sql: string, params: unknown[]): Promise<SqliteResult> | SqliteResult;
  /** Rows as value arrays, so joins keep same-named columns apart (used by strapi.db.drizzle). */
  queryValues?(sql: string, params: unknown[]): Promise<unknown[][]> | unknown[][];
  close?(): Promise<void> | void;
}

export interface SqliteDriver {
  open(settings: { filename?: string }): Promise<SqliteConnection> | SqliteConnection;
  /**
   * Pool size. Defaults to Knex's single sqlite connection. Drivers without
   * connection state (D1) raise it so concurrent requests never queue on one
   * connection.
   */
  pool?: { min: number; max: number };
  /** The D1 binding, when the driver runs on one; strapi.db.drizzle uses drizzle-orm/d1 with it. */
  d1?: D1Binding;
}

type NodeSqliteStatement = {
  columns?(): unknown[];
  setReturnArrays(enabled: boolean): void;
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
};

// Fallback for runtimes whose node:sqlite has no StatementSync#columns()
const READER_SQL = /^\s*(select|pragma|with|values|explain)\b|\breturning\b/i;

/** `node:sqlite` (Node >= 22.5, Deno 2). Synchronous, in-process, no native addon. */
export const nodeSqlite: SqliteDriver = {
  open({ filename = ':memory:' }) {
    // loaded lazily so runtimes without node:sqlite never touch it
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as any;
    const db = new DatabaseSync(filename);

    return {
      query(sql, params) {
        const statement: NodeSqliteStatement = db.prepare(sql);
        const reader = statement.columns ? statement.columns().length > 0 : READER_SQL.test(sql);

        if (reader) {
          return { reader, rows: statement.all(...params) };
        }

        const { changes, lastInsertRowid } = statement.run(...params);
        return { reader, rows: [], changes: Number(changes), lastID: Number(lastInsertRowid) };
      },
      queryValues(sql, params) {
        const statement: NodeSqliteStatement = db.prepare(sql);
        statement.setReturnArrays(true);
        return statement.all(...params) as unknown as unknown[][];
      },
      close() {
        db.close();
      },
    };
  },
};

/** The subset of Cloudflare's `D1Database` binding the driver uses. */
export interface D1Binding {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      all(): Promise<{
        results: Record<string, unknown>[];
        meta: { last_row_id?: number; changes?: number };
      }>;
    };
  };
}

const TRANSACTION_SQL = /^\s*(begin|commit|rollback|savepoint|release)\b/i;

/**
 * Cloudflare D1 through its Worker binding.
 *
 * D1 runs every statement in auto-commit and rejects BEGIN/COMMIT/ROLLBACK, so
 * transaction statements are dropped. Writes inside `strapi.db.transaction()`
 * are applied one by one and a failure part-way through is not rolled back.
 */
export const d1 = (binding: D1Binding): SqliteDriver => {
  let warned = false;

  return {
    d1: binding,
    // a "connection" is only a handle on the binding; Workers also warn when one
    // request's pending acquire is resolved by another request releasing
    pool: { min: 0, max: 100 },
    open: () => ({
      async query(sql, params) {
        if (TRANSACTION_SQL.test(sql)) {
          if (!warned) {
            warned = true;
            console.warn('[strapi:d1] D1 has no transactions; writes will not roll back on error');
          }
          return { reader: false, rows: [] };
        }

        const { results, meta } = await binding
          .prepare(sql)
          .bind(...params)
          .all();

        return {
          reader: results.length > 0 || READER_SQL.test(sql),
          rows: results,
          lastID: meta.last_row_id,
          changes: meta.changes,
        };
      },
    }),
  };
};

export const sqliteDrivers: Record<string, SqliteDriver> = {
  'node:sqlite': nodeSqlite,
};

/**
 * Knex client class that runs Knex's better-sqlite3 dialect on a `SqliteDriver`.
 * Built from the client knex already resolved, so no knex internals are imported.
 */
export const createSqliteDriverClient = (
  BaseClient: new (config: Knex.Config) => Knex.Client,
  driver: SqliteDriver
) => {
  class StrapiSqliteClient extends (BaseClient as any) {
    _driver() {
      return driver;
    }

    poolDefaults() {
      return { ...super.poolDefaults(), ...driver.pool };
    }

    async acquireRawConnection() {
      return driver.open(this.connectionSettings);
    }

    async destroyRawConnection(connection: SqliteConnection) {
      await connection.close?.();
    }

    async _query(connection: SqliteConnection, obj: any) {
      if (!obj.sql) throw new Error('The query is empty');

      const result = await connection.query(obj.sql, this._formatBindings(obj.bindings));

      obj.response = result.reader ? result.rows : result;
      obj.context = { lastID: result.lastID, changes: result.changes };
      return obj;
    }

    _formatBindings(bindings: unknown[] | undefined) {
      // node:sqlite and platform drivers reject undefined; better-sqlite3 coerces it
      return super._formatBindings(bindings).map((b: unknown) => (b === undefined ? null : b));
    }
  }

  return StrapiSqliteClient as unknown as typeof Knex.Client;
};
