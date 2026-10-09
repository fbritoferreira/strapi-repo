// On Workers the D1 binding replaces this connection (see src/worker.js).
module.exports = () => ({
  connection: {
    client: 'sqlite',
    connection: { filename: '.tmp/data.db' },
    driver: 'node:sqlite',
    useNullAsDefault: true,
  },
});
