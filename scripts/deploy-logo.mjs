import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SVG_PATH = join(ROOT, 'assets', 'logo', 'svg', '01-wifi-monogram.svg');

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const svgBuffer = await readFile(SVG_PATH);

const MASTER = await sharp(svgBuffer, { density: 144 })
  .resize(2048, 2048, { fit: 'contain', background: TRANSPARENT })
  .png()
  .toBuffer();

function renderMark(boxSize, opts = {}) {
  const { opaque = false, paddingRatio = 0 } = opts;
  const inner = Math.max(1, Math.round(boxSize * (1 - paddingRatio * 2)));
  const offset = Math.round((boxSize - inner) / 2);
  return sharp(MASTER)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT, kernel: 'lanczos3' })
    .png()
    .toBuffer()
    .then((fg) =>
      sharp({
        create: {
          width: boxSize,
          height: boxSize,
          channels: 4,
          background: opaque ? WHITE : TRANSPARENT,
        },
      })
        .composite([{ input: fg, top: offset, left: offset }])
        .png({ compressionLevel: 9 })
        .toBuffer()
    );
}

async function writePng(relPath, size, opts = {}) {
  const out = join(ROOT, relPath);
  await mkdir(dirname(out), { recursive: true });
  const buf = await renderMark(size, opts);
  await writeFile(out, buf);
  return { size, out: relPath };
}

const androidTargets = [
  ['mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
  ['mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
  ['mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
  ['mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
  ['mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
];

const iosBase = 'mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset';
const iosTargets = [
  [`${iosBase}/Icon-App-20x20@1x.png`, 20],
  [`${iosBase}/Icon-App-20x20@2x.png`, 40],
  [`${iosBase}/Icon-App-20x20@3x.png`, 60],
  [`${iosBase}/Icon-App-29x29@1x.png`, 29],
  [`${iosBase}/Icon-App-29x29@2x.png`, 58],
  [`${iosBase}/Icon-App-29x29@3x.png`, 87],
  [`${iosBase}/Icon-App-40x40@1x.png`, 40],
  [`${iosBase}/Icon-App-40x40@2x.png`, 80],
  [`${iosBase}/Icon-App-40x40@3x.png`, 120],
  [`${iosBase}/Icon-App-60x60@2x.png`, 120],
  [`${iosBase}/Icon-App-60x60@3x.png`, 180],
  [`${iosBase}/Icon-App-76x76@1x.png`, 76],
  [`${iosBase}/Icon-App-76x76@2x.png`, 152],
  [`${iosBase}/Icon-App-83.5x83.5@2x.png`, 167],
  [`${iosBase}/Icon-App-1024x1024@1x.png`, 1024],
];

const macBase = 'mobile/macos/Runner/Assets.xcassets/AppIcon.appiconset';
const macTargets = [
  [`${macBase}/app_icon_16.png`, 16],
  [`${macBase}/app_icon_32.png`, 32],
  [`${macBase}/app_icon_64.png`, 64],
  [`${macBase}/app_icon_128.png`, 128],
  [`${macBase}/app_icon_256.png`, 256],
  [`${macBase}/app_icon_512.png`, 512],
  [`${macBase}/app_icon_1024.png`, 1024],
];

const webTargetsTransparent = [
  ['mobile/web/favicon.png', 32],
  ['mobile/web/icons/Icon-192.png', 192],
  ['mobile/web/icons/Icon-512.png', 512],
];

const webMaskable = [
  ['mobile/web/icons/Icon-maskable-192.png', 192],
  ['mobile/web/icons/Icon-maskable-512.png', 512],
];

const adminTargets = [
  ['admin/public/favicon-32.png', 32],
  ['admin/public/favicon-192.png', 192],
  ['admin/public/favicon-512.png', 512],
];

const results = [];

for (const [p, s] of androidTargets) results.push(await writePng(p, s, { opaque: true }));
for (const [p, s] of iosTargets) results.push(await writePng(p, s, { opaque: true }));
for (const [p, s] of macTargets) results.push(await writePng(p, s, { opaque: true }));
for (const [p, s] of webTargetsTransparent) results.push(await writePng(p, s, { opaque: false }));
for (const [p, s] of webMaskable) results.push(await writePng(p, s, { opaque: true, paddingRatio: 0.1 }));
for (const [p, s] of adminTargets) results.push(await writePng(p, s, { opaque: false }));

const icoSizes = [16, 32, 48, 64, 128, 256];
const icoPngs = await Promise.all(icoSizes.map((s) => renderMark(s, { opaque: true })));
const icoBuf = await pngToIco(icoPngs);
const icoPath = 'mobile/windows/runner/resources/app_icon.ico';
await mkdir(dirname(join(ROOT, icoPath)), { recursive: true });
await writeFile(join(ROOT, icoPath), icoBuf);
results.push({ size: icoSizes.join('/'), out: icoPath });

console.log(`\nDeployed logo to ${results.length} destinations:\n`);
for (const r of results) {
  console.log(`  ${String(r.size).padStart(10)}  ->  ${r.out}`);
}
console.log('\nDone.');
