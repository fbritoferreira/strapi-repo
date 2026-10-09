import { createConnection } from '../../../connection';

describe('sqlite driver option', () => {
  const connect = () =>
    createConnection({
      client: 'sqlite',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      driver: 'node:sqlite',
    } as any);

  it('runs knex queries on node:sqlite', async () => {
    const knex = connect();

    await knex.schema.createTable('items', (t) => {
      t.increments('id');
      t.string('name');
      t.boolean('active');
      t.datetime('created_at');
    });

    const [inserted] = await knex('items')
      .insert({ name: 'a', active: true, created_at: new Date(0) })
      .returning('*');
    expect(inserted).toMatchObject({ id: 1, name: 'a', active: 1, created_at: 0 });

    const [id] = await knex('items').insert({ name: 'b' });
    expect(id).toBe(2);

    expect(await knex('items').where('name', 'b').update({ name: 'c' })).toBe(1);
    expect(await knex('items').pluck('name')).toEqual(['a', 'c']);
    expect(await knex('items').where('id', 1).del()).toBe(1);

    await knex.destroy();
  });

  it('keeps the sqlite client name that migrations branch on', () => {
    const knex = connect();
    expect(knex.client.config.client).toBe('better-sqlite3');
    return knex.destroy();
  });

  it('rejects unknown drivers', () => {
    expect(() =>
      createConnection({ client: 'sqlite', connection: {}, driver: 'nope' } as any)
    ).toThrow('Unknown sqlite driver nope');
  });
});
