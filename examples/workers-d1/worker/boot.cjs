// CommonJS on purpose: app files require('@strapi/strapi'), so booting through
// require keeps a single copy of Strapi (the CJS build) in the bundle.
const { createStrapi } = require('@strapi/strapi');
const { d1 } = require('@strapi/database');

module.exports = async ({ appDir, env }) => {
  const app = createStrapi({ appDir, distDir: appDir });
  app.config.set('database.connection', {
    client: 'sqlite',
    connection: {},
    driver: d1(env.DB),
    useNullAsDefault: true,
  });

  await app.load();
  app.server.mount();

  const handle = app.server.hono.fetch;
  const { pool } = app.db.connection.client;

  // Strapi finishes some work after responding (onCommit events, webhooks).
  // A Worker drops work left pending when the request ends, which here leaves
  // the pool's only connection checked out, so keep the request alive until the
  // pool is idle again.
  const settled = async () => {
    for (let i = 0; i < 200; i += 1) {
      if (pool.numUsed() + pool.numPendingAcquires() + pool.numPendingCreates() === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  return async (request, ctx) => {
    const response = await handle(request);
    ctx.waitUntil(settled());
    return response;
  };
};
