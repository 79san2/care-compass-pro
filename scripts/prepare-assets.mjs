import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const assets = ['index.html', 'consultation.js', 'manifest.json', 'icon.svg', 'sw.js',
  'knowledge/evidence.json', 'knowledge/dedup.mjs'];
const stage = await mkdtemp('.compass-build-');
try {
  for (const asset of assets) {
    const destination = join(stage, asset);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(asset, destination);
  }
  await rm('.worker-assets', { recursive: true, force: true });
  await rename(stage, '.worker-assets');
} finally {
  await rm(stage, { recursive: true, force: true });
}
