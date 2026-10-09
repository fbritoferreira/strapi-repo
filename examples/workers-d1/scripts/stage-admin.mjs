// Lays out the admin build for the assets-only admin Worker (wrangler.admin.jsonc):
// files under /admin/ as the build expects, plus /index.html so the SPA fallback
// answers deep links such as /admin/content-manager.
import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(appDir, '.admin');

rmSync(out, { recursive: true, force: true });
cpSync(path.join(appDir, 'build'), path.join(out, 'admin'), { recursive: true });
cpSync(path.join(appDir, 'build/index.html'), path.join(out, 'index.html'));
console.log(`admin staged in ${path.relative(process.cwd(), out)}`);
