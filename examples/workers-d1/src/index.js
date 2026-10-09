const { createRoute, z } = require('@hono/zod-openapi');

// A route written natively for Hono. @hono/zod-openapi validates the query and
// lists the route in /api/openapi.json next to Strapi's own content API.
const articleStats = createRoute({
  method: 'get',
  path: '/api/stats/articles',
  request: {
    query: z.object({
      since: z.iso
        .datetime()
        .optional()
        .openapi({ description: 'Only count articles created after this time' }),
    }),
  },
  responses: {
    200: {
      description: 'Article counts',
      content: {
        'application/json': {
          schema: z.object({ total: z.number().int(), since: z.string().nullable() }),
        },
      },
    },
  },
});

module.exports = {
  register({ strapi }) {
    strapi.server.hono.openapi(articleStats, async (c) => {
      const { since } = c.req.valid('query');
      const total = await strapi.documents('api::article.article').count({
        filters: since ? { createdAt: { $gt: since } } : {},
      });
      return c.json({ total, since: since ?? null }, 200);
    });
  },
  bootstrap() {},
};
