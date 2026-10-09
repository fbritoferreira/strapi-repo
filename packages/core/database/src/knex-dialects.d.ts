declare module 'knex/lib/dialects/better-sqlite3' {
  import type { Knex } from 'knex';

  const Client: new (config: Knex.Config) => Knex.Client;
  export default Client;
}
