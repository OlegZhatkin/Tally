// Сборка через esbuild: main + preload (CJS для Node/Electron), рендереры (IIFE для браузера).
// HTML/CSS копируются как есть — бандлер для них не нужен.
import { build, context } from 'esbuild';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: 'node18',
};

const bundles = [
  {
    entryPoints: [join(root, 'src/main/index.ts')],
    outfile: join(root, 'dist/main/index.js'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    ...common,
  },
  {
    entryPoints: [join(root, 'src/preload/index.ts')],
    outfile: join(root, 'dist/preload/index.js'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    ...common,
  },
  ...['popup', 'vpn', 'icon'].map((name) => ({
    entryPoints: [join(root, `src/renderer/${name}/index.ts`)],
    outfile: join(root, `dist/renderer/${name}/index.js`),
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    bundle: true,
    sourcemap: true,
    logLevel: 'info',
  })),
];

/** Копирует .html/.css рядом со скомпилированными рендерерами. */
async function copyStatic() {
  for (const name of ['popup', 'vpn', 'icon']) {
    const src = join(root, 'src/renderer', name);
    const dest = join(root, 'dist/renderer', name);
    await mkdir(dest, { recursive: true });
    for (const file of await readdir(src)) {
      if (file.endsWith('.html') || file.endsWith('.css')) {
        await cp(join(src, file), join(dest, file));
      }
    }
  }
  await cp(join(root, 'src/renderer/shared.css'), join(root, 'dist/renderer/shared.css'));
}

await copyStatic();

if (watch) {
  for (const options of bundles) {
    const ctx = await context(options);
    await ctx.watch();
  }
  console.log('[build] watching…');
} else {
  await Promise.all(bundles.map((options) => build(options)));
}
