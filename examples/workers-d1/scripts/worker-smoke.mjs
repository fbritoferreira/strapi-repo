// Content API checks against the running Worker (yarn dev, or BASE_URL=...).
// Every request must answer within 5 s; a hung pool shows up as a timeout.
import assert from 'node:assert/strict';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
let failed = 0;

const check = async (name, fn) => {
  const started = performance.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Math.round(performance.now() - started)} ms)`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err.message}`);
  }
};

const call = async (path, init = {}) => {
  const res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const send = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ data: body }),
});

const title = `worker-${Date.now()}`;
const longTitle = `${title}-a-title-long-enough-to-pass-the-d1-like-pattern-limit`;
let documentId;

await check('health answers from Hono', async () => {
  const res = await fetch(`${base}/_health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(res.status, 204);
});

await check('create', async () => {
  const res = await call('/api/articles', send('POST', { title, body: 'from the worker' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  documentId = res.body.data.documentId;
});

await check('list after a write (pool released)', async () => {
  const res = await call('/api/articles?sort=id:desc');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data[0].documentId, documentId);
});

await check('findOne', async () => {
  const res = await call(`/api/articles/${documentId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, title);
});

await check('update', async () => {
  const res = await call(`/api/articles/${documentId}`, send('PUT', { title: longTitle }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.title, longTitle);
});

await check('$startsWith with a pattern over D1 50-byte LIKE limit', async () => {
  const res = await call(
    `/api/articles?filters[title][$startsWith]=${encodeURIComponent(longTitle)}`
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.length, 1);
});

await check('$containsi short pattern', async () => {
  const res = await call(`/api/articles?filters[title][$containsi]=${title.toUpperCase()}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
});

await check('validation error is a 400', async () => {
  const res = await call('/api/articles', send('POST', { body: 'missing title' }));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.name, 'ValidationError');
});

await check('delete', async () => {
  const res = await call(`/api/articles/${documentId}`, { method: 'DELETE' });
  assert.equal(res.status, 204);
});

await check('deleted document is a 404', async () => {
  const res = await call(`/api/articles/${documentId}`);
  assert.equal(res.status, 404);
});

process.exit(failed ? 1 : 0);
