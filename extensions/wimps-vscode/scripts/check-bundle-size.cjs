const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const bundles = [
  {
    file: 'out/extension.js',
    limitKiB: Number(process.env.WIMPS_DESKTOP_BUNDLE_LIMIT_KIB ?? 4000),
  },
  {
    file: 'out/extension-web.js',
    limitKiB: Number(process.env.WIMPS_WEB_BUNDLE_LIMIT_KIB ?? 4000),
  },
  {
    file: 'out/test-web.js',
    limitKiB: Number(process.env.WIMPS_WEB_TEST_BUNDLE_LIMIT_KIB ?? 750),
  },
];

let failed = false;

for (const bundle of bundles) {
  const filePath = path.join(root, bundle.file);
  const sizeKiB = fs.statSync(filePath).size / 1024;
  const label = `${bundle.file}: ${sizeKiB.toFixed(1)} KiB / ${bundle.limitKiB} KiB`;
  if (sizeKiB > bundle.limitKiB) {
    console.error(`WIMPS bundle size exceeded: ${label}`);
    failed = true;
  } else {
    console.log(`WIMPS bundle size: ${label}`);
  }
}

if (failed) {
  process.exitCode = 1;
}
