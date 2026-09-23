#!/usr/bin/env node
/** Renders assets/icon.svg to 16/32/48/128 px PNGs in assets/icons/, committed so the build does
 * not need sharp at build time. Run with `npm run icons -w @slop-alarm/extension`. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const outDir = path.join(root, 'assets', 'icons');
const sizes = [16, 32, 48, 128];

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const svg = await fs.readFile(svgPath);
  for (const size of sizes) {
    const outPath = path.join(outDir, `icon${size}.png`);
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(outPath);
    console.log(`[icons] wrote ${path.relative(root, outPath)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
