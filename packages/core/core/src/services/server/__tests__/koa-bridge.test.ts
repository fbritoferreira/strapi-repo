import { Readable } from 'node:stream';
import Koa from 'koa';
import createKoaApp from '../koa';
import { createKoaFetch } from '../koa-bridge';

const appWith = (middleware: Koa.Middleware) => {
  const app = createKoaApp({
    proxy: false,
    proxyIpHeader: 'X-Forwarded-For',
    maxIpsCount: 0,
    keys: ['k'],
  });
  app.use(middleware);
  return createKoaFetch(app);
};

describe('koa bridge', () => {
  it('serializes object bodies as JSON and keeps headers', async () => {
    const fetch = appWith((ctx) => {
      ctx.set('x-test', '1');
      ctx.body = { method: ctx.method, path: ctx.path, query: ctx.query, ip: ctx.ip };
    });

    const res = await fetch(new Request('http://localhost/api/x?a=1'), '10.0.0.1');

    expect(res.status).toBe(200);
    expect(res.headers.get('x-test')).toBe('1');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      method: 'GET',
      path: '/api/x',
      query: { a: '1' },
      ip: '10.0.0.1',
    });
  });

  it('exposes the request body as a readable stream', async () => {
    const fetch = appWith(async (ctx) => {
      const chunks: Buffer[] = [];
      for await (const chunk of ctx.req) chunks.push(Buffer.from(chunk));
      ctx.body = Buffer.concat(chunks).toString();
    });

    const res = await fetch(new Request('http://localhost/', { method: 'POST', body: 'payload' }));

    expect(await res.text()).toBe('payload');
  });

  it('streams Readable bodies without destroying them early', async () => {
    const fetch = appWith((ctx) => {
      ctx.body = Readable.from(['a', 'b', 'c']);
    });

    expect(await (await fetch(new Request('http://localhost/'))).text()).toBe('abc');
  });

  it('keeps every Set-Cookie header, including signatures', async () => {
    const fetch = appWith((ctx) => {
      ctx.cookies.set('one', '1', { signed: true });
      ctx.status = 204;
    });

    const res = await fetch(new Request('http://localhost/'));

    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().map((c) => c.split('=')[0])).toEqual(['one', 'one.sig']);
  });

  it('uses Strapi response helpers and Koa error handling', async () => {
    const notFound = await appWith((ctx) => ctx.notFound('nope'))(new Request('http://localhost/'));
    expect(notFound.status).toBe(404);
    expect((await notFound.json()).error.message).toBe('nope');

    const thrown = await appWith((ctx) => ctx.throw(418))(new Request('http://localhost/'));
    expect(thrown.status).toBe(418);
  });

  it('returns raw writes when ctx.respond is false', async () => {
    const fetch = appWith((ctx) => {
      ctx.respond = false;
      ctx.res.writeHead(202, { 'content-type': 'text/plain' });
      ctx.res.end('raw');
    });

    const res = await fetch(new Request('http://localhost/'));

    expect(res.status).toBe(202);
    expect(await res.text()).toBe('raw');
  });
});
