const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

function hashFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return createHash('sha256').update(fileBuffer).digest('hex');
}

const inputs = {
  'output/cierre10-20261101/pediturno-backend_20261102_000852.zip':
    hashFile('output/cierre10-20261101/pediturno-backend_20261102_000852.zip'),
  'docs/android/PLAN-MAESTRO-128-PUNTOS-9-PASADAS.md':
    hashFile('docs/android/PLAN-MAESTRO-128-PUNTOS-9-PASADAS.md'),
  'docs/android/ESTADO-HACIA-PRODUCCION-20261030.md':
    hashFile('docs/android/ESTADO-HACIA-PRODUCCION-20261030.md'),
  'docs/android/COSTOS-GRATIS-REVISION-20261102.md':
    hashFile('docs/android/COSTOS-GRATIS-REVISION-20261102.md'),
  'docs/android/antigravity-cierre-20261102/ENTREGA.md':
    hashFile('docs/android/antigravity-cierre-20261102/ENTREGA.md'),
};

const outputFiles = [
  'output/antigravity-p8-implementacion-20261102/patches/01-point-103-rate-limit-and-cache.patch',
  'output/antigravity-p8-implementacion-20261102/patches/02-dependencies-security-fix.patch',
  'output/antigravity-p8-implementacion-20261102/patches/03-point-101-queue-lease-hardening.patch',
  'output/antigravity-p8-implementacion-20261102/patches/04-image-confirmation-proposal.patch',
  'output/antigravity-p8-implementacion-20261102/measurements/consumption-comparison.json',
  'output/antigravity-p8-implementacion-20261102/logs/test-results.json',
  'scripts/antigravity-p8-implementacion-20261102/test-suite.js',
  'scripts/antigravity-p8-implementacion-20261102/generate-all-patches.js',
  'scripts/antigravity-p8-implementacion-20261102/apply-dependency-patch.js',
  'scripts/antigravity-p8-implementacion-20261102/apply-invalidations.js',
];

const outputs = {};
for (const rel of outputFiles) {
  if (fs.existsSync(rel)) {
    outputs[rel] = {
      sha256: hashFile(rel),
      bytes: fs.statSync(rel).size,
    };
  }
}

const manifest = {
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    workingDirectory: path.resolve('.'),
  },
  inputs,
  outputs,
};

fs.writeFileSync(
  'output/antigravity-p8-implementacion-20261102/manifest-sha256.json',
  JSON.stringify(manifest, null, 2),
  'utf8'
);
console.log('Manifest written successfully.');
