import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Knex } from 'knex';

import { transactionCtx } from './transaction-context';
import type { Database } from '.';
import type { Column, Table } from './schema/types';

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

export const createDrizzle = (db: Database) => {
  if (db.dialect.client !== 'sqlite') {
    throw new Error(`Drizzle bridge only supports sqlite for now, got ${db.dialect.client}`);
  }

  const tables = Object.fromEntries(db.schema.schema.tables.map((t) => [t.name, toTable(t)]));

  const client = drizzle(async (sql, params, method) => {
    // Inside strapi.db.transaction() this is the transaction's own connection
    const knex: Knex = transactionCtx.get() ?? db.connection;
    const connection: SqliteConnection = await knex.client.acquireConnection();

    try {
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
