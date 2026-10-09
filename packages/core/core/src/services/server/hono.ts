import { Hono } from 'hono';
import type Koa from 'koa';
import type { IncomingMessage } from 'node:http';

import { createKoaFetch } from './koa-bridge';

type Bindings = { incoming?: IncomingMessage };

/**
 * Hono front for the Strapi server.
 *
 * Routes registered here run natively on Hono. Everything else falls through to
 * the existing Koa middleware/router stack via the Web Request bridge, so routes
 * can move across one at a time without breaking plugins written against Koa.
 */
export const createHonoApp = (koaApp: Koa) => {
  const app = new Hono<{ Bindings: Bindings }>();
  const koaFetch = createKoaFetch(koaApp);

  app.all('/_health', (c) => c.body(null, 204, { strapi: 'You are so French!' }));

  app.all('*', (c) => koaFetch(c.req.raw, c.env?.incoming?.socket.remoteAddress));

  return app;
};
