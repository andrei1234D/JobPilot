// Renders the SVG logo into every icon the apps need:
//   apps/extension/static/icons/icon{16,48,128}.png
//   apps/desktop/assets/icon.ico, icon.png, tray.png
// Run with: node scripts/make-icons.mjs   (uses the Chrome that Playwright drives)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(process.argv[2] ?? join(root, 'apps', 'web', 'public', 'icon.svg'), 'utf8');

const browser = await chromium.launch({ channel: process.env.PW_BUNDLED ? undefined : 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** An .ico is a small directory followed by the images; modern Windows accepts PNG data as-is. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const outExtension = process.argv[3] ?? join(root, 'apps', 'extension', 'static', 'icons');
const outDesktop = process.argv[4] ?? join(root, 'apps', 'desktop', 'assets');
mkdirSync(outExtension, { recursive: true });
mkdirSync(outDesktop, { recursive: true });

for (const size of [16, 48, 128]) writeFileSync(join(outExtension, `icon${size}.png`), await png(size));
writeFileSync(join(outDesktop, 'icon.png'), await png(256));
writeFileSync(join(outDesktop, 'tray.png'), await png(32));
const sizes = [16, 24, 32, 48, 64, 256];
const images = [];
for (const size of sizes) images.push({ size, data: await png(size) });
writeFileSync(join(outDesktop, 'icon.ico'), ico(images));

await browser.close();
console.log('Icons written to', outExtension, 'and', outDesktop);
