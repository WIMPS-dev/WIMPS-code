const fs = require('fs');
const path = require('path');
const Mocha = require('mocha');

async function run() {
  const mocha = new Mocha({
    color: true,
    timeout: 20000,
    ui: 'tdd',
  });

  const testsRoot = __dirname;
  for (const file of fs.readdirSync(testsRoot)) {
    if (file.endsWith('.test.js')) {
      mocha.addFile(path.join(testsRoot, file));
    }
  }

  await new Promise((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} Extension Host test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = { run };
