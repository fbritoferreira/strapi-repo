import { createCommand } from 'commander';
import fs from 'fs';
import path from 'path';
import { createStrapi } from '@strapi/core';

import type { StrapiCommand } from '../types';
import { runAction } from '../utils/helpers';
import { tryQuickOutDir } from '../utils/try-quick-outdir';

interface CmdOptions {
  admin?: boolean;
}

const action = async ({ admin = true }: CmdOptions = {}) => {
  const appDir = process.cwd();
  const tsconfigPath = path.join(appDir, 'tsconfig.json');

  let distDir: string;

  if (!fs.existsSync(tsconfigPath)) {
    distDir = appDir;
  } else {
    const quickOutDir = tryQuickOutDir(appDir, tsconfigPath);

    if (quickOutDir && fs.existsSync(path.join(quickOutDir, 'src', 'index.js'))) {
      // Built output at configured outDir — skip loading `@strapi/typescript-utils`
      distDir = quickOutDir;
    } else {
      // Custom/extended tsconfig or unbuilt project — fall back to the slow correct path
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const tsUtils = require('@strapi/typescript-utils');
      const outDir = await tsUtils.resolveOutDir(appDir);

      if (!fs.existsSync(outDir)) {
        throw new Error(
          `${outDir} directory not found. Please run the build command before starting your application`
        );
      }

      distDir = outDir;
    }
  }

  // --no-admin: serve the API only, with the admin panel built and deployed on its own
  createStrapi({ appDir, distDir, serveAdminPanel: admin }).start();
};

/**
 * `$ strapi start`
 */
const command: StrapiCommand = () => {
  return createCommand('start')
    .description('Start your Strapi application')
    .option('--no-admin', 'Do not serve the admin panel (deploy its build separately)')
    .action(runAction('start', action));
};

export { command };
