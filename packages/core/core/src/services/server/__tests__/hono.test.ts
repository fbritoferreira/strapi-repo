import { createRoute, z } from '@hono/zod-openapi';
import createKoaApp from '../koa';
import { createHonoApp, mountKoaFallback } from '../hono';

const setup = () => {
  const koa = createKoaApp({
    proxy: false,
    proxyIpHeader: 'X-Forwarded-For',
    maxIpsCount: 0,
    keys: ['k'],
  });
  koa.use((ctx) => {
    ctx.body = { from: 'koa', path: ctx.path };
  });
  return { koa, hono: createHonoApp() };
};

const route = createRoute({
  method: 'get',
  path: '/api/native',
  request: { query: z.object({ n: z.coerce.number().int() }) },
  responses: {
    200: {
      description: 'ok',
      content: { 'application/json': { schema: z.object({ n: z.number() }) } },
    },
  },
});

describe('strapi.server.hono', () => {
  it('runs routes registered before mount natively and sends the rest to Koa', async () => {
    const { koa, hono } = setup();
    hono.openapi(route, (c) => c.json({ n: c.req.valid('query').n }, 200));
    mountKoaFallback(hono, koa);

    expect(await (await hono.request('/api/native?n=3')).json()).toEqual({ n: 3 });
    expect(await (await hono.request('/api/other')).json()).toEqual({
      from: 'koa',
      path: '/api/other',
    });
  });

  it('validates with zod before the handler runs', async () => {
    const { koa, hono } = setup();
    hono.openapi(route, (c) => c.json({ n: c.req.valid('query').n }, 200));
    mountKoaFallback(hono, koa);

    expect((await hono.request('/api/native?n=nope')).status).toBe(400);
  });

  it('lists native routes in its OpenAPI document', () => {
    const { hono } = setup();
    hono.openapi(route, (c) => c.json({ n: 1 }, 200));

    const doc = hono.getOpenAPI31Document({ openapi: '3.1.0', info: { title: '', version: '' } });

    expect(Object.keys(doc.paths ?? {})).toEqual(['/api/native']);
  });

  it('answers the health check itself', async () => {
    const res = await setup().hono.request('/_health');
    expect(res.status).toBe(204);
    expect(res.headers.get('strapi')).toBe('You are so French!');
  });
});
