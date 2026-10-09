// Replays the build-time boot trace inside a Worker.
//
// Bundled CommonJS code reaches Node built-ins and computed paths through the
// global `require` (esbuild's __require falls back to it). Installing one here
// lets Strapi's loaders keep calling require(absolutePath), require.resolve()
// and fs.* exactly as they do in Node, answered from the manifest instead of a
// disk the Worker does not have.
import { Buffer } from 'node:buffer';
import path from 'node:path';
import realFs from 'node:fs';

const notFound = (p, syscall = 'stat') =>
  Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`), {
    code: 'ENOENT',
    errno: -2,
    syscall,
    path: p,
  });

const makeStats = (entry) => {
  const isDir = entry.dir !== undefined;
  const time = new Date(0);
  return {
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    size: entry.size ?? 0,
    mode: isDir ? 0o40755 : 0o100644,
    mtime: time,
    ctime: time,
    atime: time,
    birthtime: time,
    mtimeMs: 0,
  };
};

const makeDirent = ([name, isDir]) => ({
  name,
  isFile: () => !isDir,
  isDirectory: () => isDir,
  isSymbolicLink: () => false,
});

const createFs = (files) => {
  const lookup = (p) => (typeof p === 'string' ? files[path.resolve(p)] : undefined);

  const sync = {
    existsSync: (p) => {
      const entry = lookup(p);
      return entry ? !entry.missing : realFs.existsSync(p);
    },
    statSync: (p, options) => {
      const entry = lookup(p);
      if (!entry) return realFs.statSync(p, options);
      if (entry.missing) {
        if (options?.throwIfNoEntry === false) return undefined;
        throw notFound(p);
      }
      return makeStats(entry);
    },
    accessSync: (p, mode) => {
      const entry = lookup(p);
      if (!entry) return realFs.accessSync(p, mode);
      if (entry.missing) throw notFound(p, 'access');
      return undefined;
    },
    readdirSync: (p, options) => {
      const entry = lookup(p);
      if (!entry) return realFs.readdirSync(p, options);
      if (entry.missing || !entry.dir) throw notFound(p, 'scandir');
      return options?.withFileTypes ? entry.dir.map(makeDirent) : entry.dir.map(([name]) => name);
    },
    readFileSync: (p, options) => {
      const entry = lookup(p);
      if (!entry) return realFs.readFileSync(p, options);
      if (entry.missing || entry.content == null) throw notFound(p, 'open');
      const buffer = Buffer.from(entry.content, 'base64');
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? buffer.toString(encoding) : buffer;
    },
    // writes have nowhere to go; mkdir of a traced directory is a no-op
    mkdirSync: (p, options) => {
      const entry = lookup(p);
      return entry && !entry.missing ? undefined : realFs.mkdirSync(p, options);
    },
  };
  sync.lstatSync = sync.statSync;

  const promisify =
    (fn) =>
    async (...args) =>
      fn(...args);
  const callbackify =
    (fn) =>
    (...args) => {
      const cb = args.pop();
      let result;
      try {
        result = fn(...args);
      } catch (err) {
        queueMicrotask(() => cb(err));
        return;
      }
      queueMicrotask(() => cb(null, result));
    };

  const promises = { ...realFs.promises };
  const fs = { ...realFs, ...sync, promises };
  for (const [name, fn] of Object.entries(sync)) {
    const base = name.replace(/Sync$/, '');
    if (base === 'exists') continue;
    fs[base] = callbackify(fn);
    promises[base] = promisify(fn);
  }
  // fs.exists has a non-standard callback(exists) signature
  fs.exists = (p, cb) => queueMicrotask(() => cb(sync.existsSync(p)));

  return fs;
};

export const installRuntime = ({ appDir, files, resolved, modules }) => {
  const fs = createFs(files);
  const builtins = {
    fs,
    'node:fs': fs,
    'fs/promises': fs.promises,
    'node:fs/promises': fs.promises,
  };

  const loadBuiltin = (name) => {
    if (builtins[name]) return builtins[name];
    const bare = name.replace(/^node:/, '');
    return process.getBuiltinModule?.(`node:${bare}`);
  };

  const resolve = (request) => {
    if (loadBuiltin(request)) return request;
    if (resolved[request]) return resolved[request];
    if (modules[request]) return request;
    throw Object.assign(new Error(`Cannot find module '${request}' (not in the worker manifest)`), {
      code: 'MODULE_NOT_FOUND',
    });
  };

  const cache = new Map();
  const require = (request) => {
    const builtin = loadBuiltin(request);
    if (builtin) return builtin;

    const id = resolve(request);
    if (!cache.has(id)) {
      if (modules[id]) {
        cache.set(id, modules[id]());
      } else if (files[id]?.content) {
        // package.json and other JSON required by computed path
        cache.set(id, JSON.parse(Buffer.from(files[id].content, 'base64').toString('utf8')));
      } else {
        throw Object.assign(new Error(`Cannot find module '${request}'`), {
          code: 'MODULE_NOT_FOUND',
        });
      }
    }
    return cache.get(id);
  };
  require.resolve = resolve;
  require.cache = {};

  globalThis.require = require;
  process.cwd = () => appDir;
};
