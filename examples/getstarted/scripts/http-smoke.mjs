// Smoke test for the HTTP layer. Run against a started server, once per adapter:
//   STRAPI_HTTP_ADAPTER=hono yarn start   then   node scripts/http-smoke.mjs
//   STRAPI_HTTP_ADAPTER=koa  yarn start   then   node scripts/http-smoke.mjs
// Prints one line per check and exits non-zero if any check fails.
import assert from 'node:assert/strict';

const base = process.env.BASE_URL ?? 'http://localhost:1340';
const admin = { email: 'smoke@example.com', password: 'Smoke12345!' };
let failed = 0;

const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err.message}`);
  }
};

const call = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });
const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

let token;
let cookies = [];
let uploaded;

await check('health route answers 204 with custom header', async () => {
  const res = await call('/_health');
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('strapi'), 'You are so French!');
});

await check('root redirects to /admin', async () => {
  const res = await call('/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin');
});

await check('admin SPA html is served', async () => {
  const res = await call('/admin');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<html/i);
});

await check('security headers are set by koa-helmet', async () => {
  const res = await call('/admin');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

await check('HEAD has no body', async () => {
  const res = await call('/admin', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal((await res.arrayBuffer()).byteLength, 0);
});

await check('unknown route returns 404', async () => {
  const res = await call('/api/does-not-exist');
  assert.equal(res.status, 404);
});

await check('admin register or login with JSON body', async () => {
  const init = await (await call('/admin/init')).json();
  const res = init.data.hasAdmin
    ? await call('/admin/login', json(admin))
    : await call('/admin/register-admin', json({ ...admin, firstname: 'Smoke', lastname: 'Test' }));
  assert.equal(res.status, 200, await res.clone().text());
  const { data } = await res.json();
  token = data.token ?? data.accessToken;
  assert.ok(token, 'no token in response');
  cookies = res.headers.getSetCookie();
});

await check('invalid login returns a formatted 400 error', async () => {
  const res = await call('/admin/login', json({ ...admin, password: 'wrong-Password1' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.name, 'ApplicationError');
});

await check('login sets cookies through the bridged response', async () => {
  assert.ok(cookies.length > 0, 'no set-cookie headers');
});

const auth = () => ({ authorization: `Bearer ${token}` });

await check('authenticated admin endpoint', async () => {
  const res = await call('/admin/users/me', { headers: auth() });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.email, admin.email);
});

await check('content-manager create + find (document service via ctx)', async () => {
  const name = `smoke-${Date.now()}`;
  const created = await call('/content-manager/collection-types/api::tag.tag', {
    ...json({ name }),
    headers: { 'content-type': 'application/json', ...auth() },
  });
  assert.equal(created.status, 201, await created.clone().text());
  const list = await call(
    `/content-manager/collection-types/api::tag.tag?filters[name][$eq]=${name}`,
    { headers: auth() }
  );
  assert.equal((await list.json()).results.length, 1);
});

await check('multipart upload (koa-body/formidable reads the bridged stream)', async () => {
  const form = new FormData();
  form.append('files', new Blob(['hello from smoke test'], { type: 'text/plain' }), 'smoke.txt');
  const res = await call('/upload', { method: 'POST', body: form, headers: auth() });
  assert.equal(res.status, 201, await res.clone().text());
  [uploaded] = await res.json();
  assert.equal(uploaded.ext, '.txt');
});

await check('uploaded file streams back (koa-static stream body)', async () => {
  const res = await call(uploaded.url);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'hello from smoke test');
});

process.exit(failed ? 1 : 0);
