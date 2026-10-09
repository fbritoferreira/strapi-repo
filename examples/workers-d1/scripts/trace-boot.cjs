// Boots the app in Node and records what Strapi reads from disk and requires by
// computed path, so build-worker.mjs can replay it inside a Worker, which has no
// app files on disk and cannot require() a path it did not bundle.
//
// Usage: node scripts/trace-boot.cjs <out.json>
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const appDir = path.resolve(__dirname, '..');
const out = process.argv[2];

const touched = new Map(); // path -> Set of 'stat' | 'readdir' | 'read'
const touch = (p, op) => {
  if (typeof p !== 'string' && !(p instanceof URL)) return;
  const abs = path.resolve(String(p instanceof URL ? p.pathname : p));
  if (!touched.has(abs)) touched.set(abs, new Set());
  touched.get(abs).add(op);
};

const ops = {
  stat: ['existsSync', 'statSync', 'lstatSync', 'accessSync', 'stat', 'lstat', 'access', 'exists'],
  readdir: ['readdirSync', 'readdir', 'opendirSync', 'opendir'],
  read: ['readFileSync', 'readFile', 'createReadStream'],
};
for (const [op, names] of Object.entries(ops)) {
  for (const name of names) {
    for (const target of [fs, fs.promises]) {
      const original = target[name];
      if (typeof original !== 'function') continue;
      target[name] = function traced(p, ...rest) {
        // skip Node's own module loader reading sources; esbuild bundles those
        const caller = new Error().stack.split('\n')[2] ?? '';
        if (!caller.includes('node:internal/modules')) touch(p, op);
        return original.call(this, p, ...rest);
      };
    }
  }
}

// computed requires: absolute paths, package.json files and bare package names
const resolved = {};
const dynamic = new Set();
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function tracedResolve(request, parent, ...rest) {
  const filename = originalResolve.call(this, request, parent, ...rest);
  const isRelative = request.startsWith('./') || request.startsWith('../');
  if (!isRelative && !Module.isBuiltin(request)) {
    resolved[request] = filename;
    if (path.isAbsolute(request) || request.endsWith('package.json')) dynamic.add(filename);
  }
  return filename;
};

const main = async () => {
  const { createStrapi } = require('@strapi/strapi');
  const app = createStrapi({ appDir, distDir: appDir });
  await app.load();
  app.server.mount();

  // a couple of requests so lazily-read files (favicon, route handlers) are recorded too
  const fetchApp = app.server.hono.fetch;
  await fetchApp(new Request('http://localhost/api/articles'));
  await fetchApp(new Request('http://localhost/favicon.ico'));
  await app.destroy();

  const files = {};
  for (const [p, seen] of touched) {
    if (!fs.existsSync(p)) {
      files[p] = { missing: true };
      continue;
    }
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      files[p] = {
        dir: seen.has('readdir')
          ? fs.readdirSync(p, { withFileTypes: true }).map((d) => [d.name, d.isDirectory()])
          : null,
      };
    } else {
      files[p] = {
        size: stat.size,
        content: seen.has('read') ? fs.readFileSync(p).toString('base64') : null,
      };
    }
  }

  fs.writeFileSync(
    out,
    JSON.stringify({ appDir, files, resolved, dynamic: [...dynamic] }, null, 1)
  );
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
