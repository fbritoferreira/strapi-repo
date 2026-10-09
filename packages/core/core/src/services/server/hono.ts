import { OpenAPIHono } from '@hono/zod-openapi';
import type Koa from 'koa';
import type { IncomingMessage } from 'node:http';

import { createKoaFetch } from './koa-bridge';

type Bindings = { incoming?: IncomingMessage };

export type StrapiHono = OpenAPIHono<{ Bindings: Bindings }>;

/**
 * Hono front for the Strapi server, exposed as `strapi.server.hono`.
 *
 * Apps and plugins can register routes on it with `@hono/zod-openapi` during
 * register/bootstrap; those run natively and appear in the content API OpenAPI
 * document. Everything else falls through to the Koa stack (see mountKoaFallback).
 */
export const createHonoApp = (): StrapiHono => {
  const app: StrapiHono = new OpenAPIHono();

  app.all('/_health', (c) => c.body(null, 204, { strapi: 'You are so French!' }));

  return app;
};

/**
 * Sends every request no Hono route matched to the Koa middleware and router
 * stack. Registered at mount so that routes added before it take priority.
 */
export const mountKoaFallback = (hono: StrapiHono, koaApp: Koa) => {
  const koaFetch = createKoaFetch(koaApp);

  hono.all('*', (c) => koaFetch(c.req.raw, c.env?.incoming?.socket.remoteAddress));
};
