// Bundles the extension into extension/dist, ready for "Load unpacked". Works offline.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

const { version } = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: ['background', 'options', 'popup'].map((name) => join(here, 'src', `${name}.ts`)),
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  platform: 'browser',
  logLevel: 'warning',
});

// The app, engine, queue and extension share one version, taken from the root package.json.
const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
await writeFile(join(dist, 'manifest.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
for (const page of ['popup.html', 'options.html']) await copyFile(join(here, 'src', page), join(dist, page));

console.log(`Built the Fetchdeck extension ${version} in ${dist}`);
