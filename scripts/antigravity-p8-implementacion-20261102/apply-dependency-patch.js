const fs = require('fs');
const path = require('path');

function updateDependencies(targetDir) {
  // 1. package.json
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.devDependencies.vitest = '4.1.12';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // 2. package-lock.json
  const lockPath = path.join(targetDir, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  // Update top-level packages[""].devDependencies
  if (lock.packages && lock.packages['']) {
    lock.packages[''].devDependencies.vitest = '4.1.12';
  }

  // Map of updates
  const vitestSubpackages = [
    'vitest',
    '@vitest/expect',
    '@vitest/mocker',
    '@vitest/pretty-format',
    '@vitest/runner',
    '@vitest/snapshot',
    '@vitest/spy',
    '@vitest/utils'
  ];

  const integrities = {
    'vitest': 'sha512-5eWdz2yb3ajxWF3C8C4TjkXl7FGm3n2E/VlazALrQHzK7nYMSGFnCZto0bbPNl77AwkOZVLk0YnBAejUu0NiWA==',
    '@vitest/mocker': 'sha512-fKShNpKZzupWZuY0z7egydvL0sqW4INEZBEExMBMAa6izlENEVHwoXgdaTCaBZ5fwlr4xf2o1wXC83n9RpO+NA==',
    '@vitest/expect': 'sha512-vFlTt+YEu9WBpNjdGayNmlMVzrWPi1+sv853/7t2FU7hpO5gAFBKHzQmkCq5Xjpr+evegF2994LQT3hF3mRlqQ==',
    '@vitest/pretty-format': 'sha512-XW9O8+Mxx4VpCtkYdMJLZQQwsVryP9wk7cPKDxtXFfwSak6yRh5+2fep/Y0XF/ElBvJHq8bcYdi6aeuai0opZA==',
    '@vitest/runner': 'sha512-NKlVKCr5QnCe8jijdMnmkpHHU+WTqiLFR6G0pHji9uRjXK9xJl1k1nTw6F3pOOj2PDcsDt2GKQMI7wIsaT491w==',
    '@vitest/snapshot': 'sha512-ko1y1Qgb/slzQ9mr+b89Cuqud8WG1TKtsPD8r7ZUBdvVOGt85Af2HwCqHujrhwJq95hs/9RM7fcAPg57o1vlzw==',
    '@vitest/spy': 'sha512-RGq9x4JNGNTZHEJxvN0oSiJjeSCExm0n2gZKKJZHY9cX5AVA6M7VJILBT3ZJ/tJ/0J9uWT7fETV9/btoi//vSg==',
    '@vitest/utils': 'sha512-Q3awXrwOfEV+qc3WmO5ONyE0yO7Q1gQ9/oyHxGLZ/pl7N3NO/ZztqQwKLuwMkV+CA1JYSIeO3gkHnRDIo4AVaA==',
    'vite': 'sha512-AHEzTORMbi7/7aXp7w7KZ5+DCUdSeLsJz0grY8xHpc9DHdYb0vQu6DqJfm2tOw3gDExNgPgnJTXxM6syYFHaCA=='
  };

  const tarballs = {
    'vitest': 'https://registry.npmjs.org/vitest/-/vitest-4.1.12.tgz',
    '@vitest/mocker': 'https://registry.npmjs.org/@vitest/mocker/-/mocker-4.1.12.tgz',
    '@vitest/expect': 'https://registry.npmjs.org/@vitest/expect/-/expect-4.1.12.tgz',
    '@vitest/pretty-format': 'https://registry.npmjs.org/@vitest/pretty-format/-/pretty-format-4.1.12.tgz',
    '@vitest/runner': 'https://registry.npmjs.org/@vitest/runner/-/runner-4.1.12.tgz',
    '@vitest/snapshot': 'https://registry.npmjs.org/@vitest/snapshot/-/snapshot-4.1.12.tgz',
    '@vitest/spy': 'https://registry.npmjs.org/@vitest/spy/-/spy-4.1.12.tgz',
    '@vitest/utils': 'https://registry.npmjs.org/@vitest/utils/-/utils-4.1.12.tgz',
    'vite': 'https://registry.npmjs.org/vite/-/vite-7.3.7.tgz'
  };

  for (const name of vitestSubpackages) {
    const key = `node_modules/${name}`;
    if (lock.packages[key]) {
      lock.packages[key].version = '4.1.12';
      lock.packages[key].resolved = tarballs[name];
      lock.packages[key].integrity = integrities[name];
      if (lock.packages[key].dependencies) {
        for (const dep of Object.keys(lock.packages[key].dependencies)) {
          if (vitestSubpackages.includes(dep)) {
            lock.packages[key].dependencies[dep] = '4.1.12';
          }
        }
      }
    }
  }

  // Update vite
  if (lock.packages['node_modules/vite']) {
    lock.packages['node_modules/vite'].version = '7.3.7';
    lock.packages['node_modules/vite'].resolved = tarballs['vite'];
    lock.packages['node_modules/vite'].integrity = integrities['vite'];
  }

  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  console.log('Successfully updated package.json and package-lock.json in ' + targetDir);
}

module.exports = { updateDependencies };

if (require.main === module) {
  const targetDir = process.argv[2] || 'output/antigravity-p8-implementacion-20261102/workspace';
  updateDependencies(targetDir);
}
