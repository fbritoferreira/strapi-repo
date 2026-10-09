import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Knex } from 'knex';

import { transactionCtx } from './transaction-context';
import type { Database } from '.';
import type { Column, Table } from './schema/types';
import type { SqliteConnection as DriverConnection, SqliteDriver } from './dialects/sqlite/driver';

/**
 * Drizzle over Strapi's own tables.
 *
 * Tables are built from the schema Strapi already derives from content types,
 * so every collection (and its join tables) is queryable with Drizzle without a
 * second schema to maintain. Queries run on Knex's connection, which means they
 * see the same data and join the same `strapi.db.transaction()` as the
 * document service.
 */

// ponytail: sqlite only. Postgres and MySQL need the pg-core/mysql-core
// builders and the pg-proxy/mysql-proxy drivers wired the same way.
const toColumn = (column: Column) => {
  const { name } = column;
  switch (column.type) {
    case 'increments':
      return integer(name).primaryKey({ autoIncrement: true });
    case 'integer':
    case 'bigInteger':
      return integer(name);
    case 'boolean':
      return integer(name, { mode: 'boolean' });
    case 'double':
    case 'decimal':
    case 'float':
      return real(name);
    case 'datetime':
    case 'timestamp':
      return integer(name, { mode: 'timestamp_ms' });
    case 'jsonb':
    case 'json':
      return text(name, { mode: 'json' });
    default:
      return text(name);
  }
};

const toTable = (table: Table) =>
  sqliteTable(
    table.name,
    Object.fromEntries(table.columns.map((column) => [column.name, toColumn(column)]))
  );

type SqliteStatement = {
  reader: boolean;
  raw(toggle: boolean): SqliteStatement;
  run(params: unknown[]): unknown;
  all(params: unknown[]): unknown[];
  get(params: unknown[]): unknown;
};
type SqliteConnection = { prepare(sql: string): SqliteStatement };

type Method = 'run' | 'all' | 'values' | 'get';

const viaBetterSqlite3 = (
  connection: SqliteConnection,
  sql: string,
  params: unknown[],
  method: Method
) => {
  const statement = connection.prepare(sql);
  if (!statement.reader) {
    statement.run(params);
    return { rows: [] };
  }

  // positional rows: object rows would collapse same-named columns in joins
  statement.raw(true);
  return {
    rows: method === 'get' ? (statement.get(params) as unknown[]) : statement.all(params),
  };
};

const viaDriver = async (
  connection: DriverConnection,
  sql: string,
  params: unknown[],
  method: Method
) => {
  if (method === 'run') {
    await connection.query(sql, params);
    return { rows: [] };
  }

  // positional rows when the driver has them; object rows lose same-named join columns
  const rows = connection.queryValues
    ? await connection.queryValues(sql, params)
    : (await connection.query(sql, params)).rows.map((row) => Object.values(row));
  return { rows: method === 'get' ? rows[0] : rows };
};

export const createDrizzle = (db: Database) => {
  if (db.dialect.client !== 'sqlite') {
    throw new Error(`Drizzle bridge only supports sqlite for now, got ${db.dialect.client}`);
  }

  const tables = Object.fromEntries(db.schema.schema.tables.map((t) => [t.name, toTable(t)]));

  const { driver } = db.config.connection as { driver?: SqliteDriver };

  // On D1, use Drizzle's own D1 driver: same binding, plus D1's atomic batch()
  const client = driver?.d1
    ? drizzleD1(driver.d1 as any)
    : drizzle(async (sql, params, method) => {
        // Inside strapi.db.transaction() this is the transaction's own connection
        const knex: Knex = transactionCtx.get() ?? db.connection;
        const connection = await knex.client.acquireConnection();

        try {
          return 'query' in connection
            ? await viaDriver(connection, sql, params, method)
            : viaBetterSqlite3(connection, sql, params, method);
        } finally {
          await knex.client.releaseConnection(connection);
        }
      });

  return {
    client,
    tables,
    /** Drizzle table for a content type or component uid, e.g. `api::article.article`. */
    table(uid: string) {
      return tables[db.metadata.get(uid).tableName];
    },
  };
};
