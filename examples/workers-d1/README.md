# Strapi on Cloudflare Workers with D1

Two deployments:

| Worker                    | Config                 | Serves                           |
| ------------------------- | ---------------------- | -------------------------------- |
| `strapi-workers-d1`       | `wrangler.jsonc`       | content API and admin API, on D1 |
| `strapi-workers-d1-admin` | `wrangler.admin.jsonc` | the admin panel as static assets |

The admin panel calls the API Worker at `PUBLIC_URL` (`config/server.js`), which
`strapi build` bakes into the admin bundle. The API Worker answers CORS for the
admin origin with credentials.

## Run locally

```sh
yarn build:worker        # trace a Node boot, bundle .worker/worker.mjs
yarn wrangler dev        # API on http://127.0.0.1:8787, local D1
yarn build:admin         # strapi build, staged into .admin/
yarn dev:admin           # admin on http://127.0.0.1:8788/admin
node scripts/worker-smoke.mjs
```

## How the API Worker is built

Strapi discovers config, APIs and plugins by reading the filesystem and calling
`require()` on computed paths. A Worker has neither.

1. `scripts/trace-boot.cjs` boots the app in Node and records each file Strapi
   reads and each computed `require()`.
2. `scripts/build-worker.mjs` writes that trace as `.worker/manifest.mjs`, with a
   static `require()` per computed path so esbuild bundles it.
3. `worker/runtime.mjs` installs a global `require` and an `fs` overlay that
   answer from the manifest. Strapi's loaders run unchanged.
4. `worker/boot.cjs` boots Strapi on the first request with the `d1()` driver
   from `@strapi/database` and serves through `createHonoApp`.

Rebuild the Worker after changing config or content types.

## Limits

- **No rollback.** D1 has no `BEGIN`/`ROLLBACK`; a write that fails part-way is
  not undone.
- **No image processing.** `sharp` is a native addon; uploading an image that
  needs resizing fails. File uploads also need a remote provider (R2, S3), since
  the Worker has no disk.
- **Memory.** Workers allow 128 MB per isolate. Not yet measured on a deployed
  Worker; `wrangler dev` does not enforce it.
