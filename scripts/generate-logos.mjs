import { readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SVG_DIR = join(ROOT, 'assets', 'logo', 'svg');
const PNG_DIR = join(ROOT, 'assets', 'logo', 'png');
const SIZES = [1024, 512, 256, 128];

async function main() {
  if (!existsSync(SVG_DIR)) {
    console.error(`SVG source dir not found: ${SVG_DIR}`);
    process.exit(1);
  }
  await mkdir(PNG_DIR, { recursive: true });

  const entries = (await readdir(SVG_DIR)).filter((f) => f.endsWith('.svg')).sort();
  if (entries.length === 0) {
    console.error(`No SVGs found in ${SVG_DIR}`);
    process.exit(1);
  }

  const rows = [];
  for (const svgFile of entries) {
    const svgPath = join(SVG_DIR, svgFile);
    const svgBuffer = await readFile(svgPath);
    const name = basename(svgFile, '.svg');
    for (const size of SIZES) {
      const outPath = join(PNG_DIR, `${name}-${size}.png`);
      await sharp(svgBuffer, { density: Math.ceil((72 * size) / 1024) })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toFile(outPath);
      rows.push({ concept: name, size, out: outPath });
    }
  }

  console.log(`\nGenerated ${rows.length} PNGs from ${entries.length} SVG concepts:\n`);
  for (const r of rows) {
    console.log(`  ${r.concept.padEnd(24)} ${String(r.size).padStart(5)}px  ->  ${r.out}`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
