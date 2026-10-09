const { createRoute, z } = require('@hono/zod-openapi');
const { desc } = require('drizzle-orm');

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

// Same idea, querying with Drizzle. On D1, strapi.db.drizzle runs on drizzle-orm/d1
// with the Worker's binding.
const recentArticles = createRoute({
  method: 'get',
  path: '/api/stats/recent',
  request: {
    query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(3) }),
  },
  responses: {
    200: {
      description: 'Most recently created articles',
      content: {
        'application/json': {
          schema: z.array(z.object({ title: z.string(), createdAt: z.string() })),
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

    strapi.server.hono.openapi(recentArticles, async (c) => {
      const { limit } = c.req.valid('query');
      const { client, table } = strapi.db.drizzle;
      const articles = table('api::article.article');
      const rows = await client
        .select({ title: articles.title, createdAt: articles.created_at })
        .from(articles)
        .orderBy(desc(articles.created_at))
        .limit(limit);
      return c.json(
        rows.map((row) => ({ title: row.title, createdAt: row.createdAt.toISOString() })),
        200
      );
    });
  },
  bootstrap() {},
};
