import knex from 'knex';
import type { Knex } from 'knex';
import BetterSqlite3Client from 'knex/lib/dialects/better-sqlite3';

import {
  createSqliteDriverClient,
  sqliteDrivers,
  type SqliteDriver,
} from './dialects/sqlite/driver';

const clientMap = {
  sqlite: 'better-sqlite3',
  mysql: 'mysql2',
  postgres: 'pg',
};

type ClientKind = keyof typeof clientMap;

export function isDatabaseClientKind(client: unknown): client is ClientKind {
  return (client as string) in clientMap;
}

export const createConnection = (userConfig: Knex.Config, strapiConfig?: Partial<Knex.Config>) => {
  if (!isDatabaseClientKind(userConfig.client)) {
    throw new Error(`Unsupported database client ${userConfig.client}`);
  }

  const { driver, ...rest } = userConfig as Knex.Config & { driver?: string | SqliteDriver };
  const knexConfig: Knex.Config = { ...rest, client: clientMap[userConfig.client] };

  if (driver && userConfig.client === 'sqlite') {
    const sqliteDriver = typeof driver === 'string' ? sqliteDrivers[driver] : driver;
    if (!sqliteDriver) {
      throw new Error(`Unknown sqlite driver ${driver}. Available: ${Object.keys(sqliteDrivers)}`);
    }

    knexConfig.client = createSqliteDriverClient(BetterSqlite3Client, sqliteDriver);
  }

  // initialization code to run upon opening a new connection
  if (strapiConfig?.pool?.afterCreate) {
    knexConfig.pool = knexConfig.pool || {};
    // if the user has set their own afterCreate in config, we will replace it and call it
    const userAfterCreate = knexConfig.pool?.afterCreate;
    const strapiAfterCreate = strapiConfig.pool.afterCreate;
    knexConfig.pool.afterCreate = (
      conn: unknown,
      done: (err: Error | null | undefined, connection: any) => void
    ) => {
      strapiAfterCreate(conn, (err: Error | null | undefined, nativeConn: any) => {
        if (err) {
          return done(err, nativeConn);
        }
        if (userAfterCreate) {
          return userAfterCreate(nativeConn, done);
        }
        return done(null, nativeConn);
      });
    };
  }

  const instance = knex(knexConfig);
  // migrations branch on the client name to pick sqlite batch sizes and upsert syntax
  instance.client.config.client = clientMap[userConfig.client];
  return instance;
};
