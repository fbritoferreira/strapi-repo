// Cloudflare Worker entry: boots Strapi on the first request, then serves every
// request through the Hono app. Strapi is imported only after the runtime shim
// is installed, because its modules read fs and require() while they load.
import * as manifest from '../.worker/manifest.mjs';
import { installRuntime } from './runtime.mjs';

installRuntime(manifest);

let booting;

const boot = async (env) => {
  const { default: start } = await import('./boot.cjs');
  return start({ appDir: manifest.appDir, env });
};

export default {
  async fetch(request, env, ctx) {
    booting ??= boot(env).catch((err) => {
      console.error('strapi boot failed', err.stack);
      booting = undefined;
      throw err;
    });
    const handle = await booting;
    return handle(request, ctx);
  },
};
