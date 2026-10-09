import type * as http from 'http';
import type Router from '@koa/router';
import type Koa from 'koa';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type * as Core from '../core';

export interface HTTPServer extends http.Server {
  destroy: () => Promise<void>;
}

export interface API {
  listRoutes(): Router.Layer[];
  use(fn: Router.Middleware): API;
  routes(routes: Core.Router | Omit<Core.Route, 'info'>[]): this;
  mount(router: Router): this;
}

export interface Server {
  app: Koa;
  router: Router;
  /**
   * Hono app in front of Koa (server.http.adapter: 'hono'). Routes registered on it
   * with @hono/zod-openapi during register/bootstrap run natively and are listed in
   * the content API OpenAPI document; other requests fall through to Koa.
   */
  hono: OpenAPIHono<any>;
  httpServer: HTTPServer;
  api(name: 'content-api'): API;
  api(name: 'admin'): API;
  use(...args: Parameters<Koa['use']>): Server;
  routes(routes: Core.Router | Omit<Core.Route, 'info'>[]): this;
  mount(): this;
  initRouting(): this;
  initMiddlewares(): Promise<this>;
  listRoutes(): Router.Layer[];
  listen: HTTPServer['listen'];
  destroy(): Promise<void>;
}
