#!/usr/bin/env node

/**
 * Check for required system dependencies
 * This script runs after npm install to verify system packages are installed
 */

const { execSync } = require('child_process');

const requiredPackages = [
  { cmd: 'pdftoppm', package: 'poppler-utils', description: 'PDF to CBZ conversion' },
  { cmd: 'zip', package: 'zip', description: 'Creating CBZ archives' },
  { cmd: 'unrar', package: 'unrar', description: 'CBR to CBZ conversion' }
];

let missingPackages = [];

console.log('Checking system dependencies...\n');

requiredPackages.forEach(({ cmd, package: pkg, description }) => {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    console.log(`✅ ${cmd} - Found`);
  } catch (error) {
    console.log(`❌ ${cmd} - Not found (${description})`);
    missingPackages.push(pkg);
  }
});

if (missingPackages.length > 0) {
  console.log('\n⚠️  Missing system dependencies detected!\n');
  console.log('Please install the following packages:');
  console.log(`\n  sudo apt install ${missingPackages.join(' ')}\n`);
  console.log('These packages are required for:');
  requiredPackages.forEach(({ package: pkg, description }) => {
    if (missingPackages.includes(pkg)) {
      console.log(`  - ${pkg}: ${description}`);
    }
  });
  console.log('\nThe app will still run, but PDF/CBR conversion will not work.');
  console.log('See README.md for more information.\n');
} else {
  console.log('\n✅ All system dependencies are installed!\n');
}
