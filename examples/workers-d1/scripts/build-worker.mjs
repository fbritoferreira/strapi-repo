// Builds .worker/worker.mjs: traces a Node boot, writes the manifest the Worker
// replays, then bundles Strapi and the app with esbuild.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(appDir, '.worker');
mkdirSync(outDir, { recursive: true });

const tracePath = path.join(outDir, 'trace.json');
execFileSync(process.execPath, [path.join(appDir, 'scripts/trace-boot.cjs'), tracePath], {
  cwd: appDir,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, STRAPI_TELEMETRY_DISABLED: 'true' },
});
const trace = JSON.parse(readFileSync(tracePath, 'utf8'));

// static require() per computed path, so esbuild bundles each one
const modules = trace.dynamic
  .map((file) => `  ${JSON.stringify(file)}: () => require(${JSON.stringify(file)}),`)
  .join('\n');
writeFileSync(
  path.join(outDir, 'manifest.mjs'),
  `export const appDir = ${JSON.stringify(trace.appDir)};
export const files = ${JSON.stringify(trace.files)};
export const resolved = ${JSON.stringify(trace.resolved)};
export const modules = {
${modules}
};
`
);

// Node-only packages Strapi references but never calls on this path
const stub = path.join(appDir, 'worker/stub.cjs');
const external = [
  'better-sqlite3',
  'sqlite3',
  'pg',
  'pg-native',
  'pg-query-stream',
  'mysql',
  'mysql2',
  'oracledb',
  'tedious',
  'fsevents',
  // optional rate-limit stores in koa2-ratelimit
  'mongoose',
  'redis',
  'sequelize',
];

const dirnamePlugin = {
  name: 'dirname',
  setup(b) {
    // bundled files keep their build-machine __dirname, which the manifest is keyed by
    b.onLoad({ filter: /\.(c|m)?js$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes('__dirname') && !source.includes('__filename')) return undefined;
      return {
        contents: `var __dirname = ${JSON.stringify(path.dirname(args.path))}, __filename = ${JSON.stringify(args.path)};\n${source}`,
        loader: 'js',
      };
    });
  },
};

const result = await build({
  entryPoints: [path.join(appDir, 'worker/index.mjs')],
  outfile: path.join(outDir, 'worker.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  conditions: ['workerd', 'worker'],
  external,
  alias: {
    '@strapi/typescript-utils': stub,
    typescript: stub,
    sharp: path.join(appDir, 'worker/sharp.cjs'),
    // uses new Function, which Workers forbid
    depd: path.join(appDir, 'worker/depd.cjs'),
  },
  plugins: [dirnamePlugin],
  metafile: true,
  logLevel: 'warning',
  logOverride: { 'require-resolve-not-external': 'silent', 'empty-import-meta': 'silent' },
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`worker bundle: ${(bytes / 1048576).toFixed(1)} MiB`);
