import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import compose from 'koa-compose';
import type Koa from 'koa';

/**
 * Runs a Koa app against a Web `Request` and returns a Web `Response`.
 *
 * Koa only touches a small surface of Node's `req`/`res` (headers, url, method,
 * socket address, and the `setHeader`/`getHeader` family). This bridge provides
 * that surface without a real socket, so the Koa context, its prototypes and
 * every `ctx.*` helper Strapi adds keep working unchanged behind Hono.
 */

class BridgeResponse extends EventEmitter {
  statusCode = 404;

  statusMessage = '';

  headersSent = false;

  writableEnded = false;

  finished = false;

  socket = undefined;

  chunks: Buffer[] = [];

  #headers = new Map<string, number | string | string[]>();

  setHeader(name: string, value: number | string | string[]) {
    this.#headers.set(name.toLowerCase(), value);
    return this;
  }

  getHeader(name: string) {
    return this.#headers.get(name.toLowerCase());
  }

  getHeaders() {
    return Object.fromEntries(this.#headers);
  }

  getHeaderNames() {
    return [...this.#headers.keys()];
  }

  hasHeader(name: string) {
    return this.#headers.has(name.toLowerCase());
  }

  removeHeader(name: string) {
    this.#headers.delete(name.toLowerCase());
  }

  flushHeaders() {}

  writeHead(status: number, headers?: Record<string, string | string[]>) {
    this.statusCode = status;
    Object.entries(headers ?? {}).forEach(([k, v]) => this.setHeader(k, v));
    return this;
  }

  // ponytail: raw writes (ctx.respond = false) are buffered, not streamed. Swap
  // the chunk array for a TransformStream if a raw-writing route needs streaming.
  write(chunk: string | Buffer) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  end(chunk?: string | Buffer) {
    if (chunk) this.write(chunk);
    this.headersSent = true;
    this.writableEnded = true;
    this.finished = true;
    return this;
  }

  toHeaders() {
    const headers = new Headers();
    for (const [name, value] of this.#headers) {
      for (const v of Array.isArray(value) ? value : [value]) headers.append(name, String(v));
    }
    return headers;
  }
}

const createBridgeRequest = (request: Request, remoteAddress?: string) => {
  const url = new URL(request.url);
  const body = request.body
    ? Readable.fromWeb(request.body as import('node:stream/web').ReadableStream)
    : Readable.from([]);

  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });

  return Object.assign(body, {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    httpVersionMajor: 1,
    httpVersion: '1.1',
    socket: { remoteAddress, encrypted: url.protocol === 'https:' },
  });
};

const EMPTY_BODY_STATUSES = new Set([204, 205, 304]);

/** Mirrors Koa's private `respond()` but builds a Web Response instead of writing a socket. */
const toResponse = (ctx: Koa.Context, res: BridgeResponse): Response => {
  if (ctx.respond === false || res.writableEnded) {
    return new Response(res.chunks.length ? Buffer.concat(res.chunks) : null, {
      status: res.statusCode,
      headers: res.toHeaders(),
    });
  }

  const { status } = ctx;
  let { body } = ctx;

  if (EMPTY_BODY_STATUSES.has(status) || ctx.method === 'HEAD') {
    body = null;
  } else if (body == null) {
    const explicitNull = Reflect.get(ctx.response, '_explicitNullBody');
    body = explicitNull ? '' : ctx.message || String(status);
    if (!explicitNull) ctx.type = 'text';
  } else if (body instanceof Readable) {
    // PassThrough turns string/object-mode chunks into the bytes a Web stream requires
    body = Readable.toWeb(body.pipe(new PassThrough()));
  } else if (!Buffer.isBuffer(body) && typeof body !== 'string') {
    body = JSON.stringify(body);
  }

  return new Response(body as ConstructorParameters<typeof Response>[0], {
    status,
    statusText: res.statusMessage || undefined,
    headers: res.toHeaders(),
  });
};

export const createKoaFetch = (app: Koa) => {
  let run: compose.ComposedMiddleware<Koa.Context> | undefined;

  return async (request: Request, remoteAddress?: string): Promise<Response> => {
    // composed lazily: plugins keep calling app.use() until the server is mounted
    if (!run) {
      run = compose(app.middleware);
      // same default as Koa's app.callback(): without a listener, ctx.onerror's emit throws
      if (!app.listenerCount('error')) app.on('error', app.onerror);
    }

    const req = createBridgeRequest(request, remoteAddress);
    const res = new BridgeResponse();
    const ctx = app.createContext(req as any, res as any);

    try {
      await run(ctx);
    } catch (err) {
      ctx.onerror(err as Error);
    }

    const response = toResponse(ctx, res);

    // Koa destroys a stream body on 'finish', so only signal it once the stream is drained
    const finish = () => res.emit('finish');
    if (ctx.respond !== false && ctx.body instanceof Readable) {
      ctx.body.once('close', finish);
    } else {
      finish();
    }

    return response;
  };
};
