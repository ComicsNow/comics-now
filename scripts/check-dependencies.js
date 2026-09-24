#!/usr/bin/env node

/**
 * Check for required system dependencies
 * This script runs after npm install to verify system packages are installed
 */

const { execSync } = require('child_process');

const requiredPackages = [
  { cmd: 'pdftoppm', package: 'poppler-utils', brewPackage: 'poppler', description: 'PDF to CBZ conversion' },
  { cmd: 'zip', package: 'zip', brewPackage: 'zip', description: 'Creating CBZ archives' },
  { cmd: 'unrar', package: 'unrar', brewPackage: 'unrar', description: 'CBR to CBZ conversion' }
];

function commandExists(cmd) {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let missingPackages = [];

console.log('Checking system dependencies...\n');

requiredPackages.forEach(({ cmd, package: pkg, brewPackage, description }) => {
  if (commandExists(cmd)) {
    console.log(`✅ ${cmd} - Found`);
  } else {
    console.log(`❌ ${cmd} - Not found (${description})`);
    missingPackages.push({ cmd, pkg, brewPackage, description });
  }
});

if (missingPackages.length > 0) {
  console.log('\n⚠️  Missing system dependencies detected!\n');
  console.log('Please install the following packages for your operating system:\n');

  if (process.platform === 'darwin') {
    const brewPkgs = missingPackages.map(p => p.brewPackage).join(' ');
    console.log(`  macOS (Homebrew):\n    brew install ${brewPkgs}\n`);
  } else if (process.platform === 'win32') {
    const winPkgs = missingPackages.map(p => p.pkg).join(' ');
    console.log(`  Windows (Chocolatey / Scoop):\n    choco install ${winPkgs}\n    scoop install ${winPkgs}\n`);
  } else {
    const aptPkgs = missingPackages.map(p => p.pkg).join(' ');
    console.log(`  Debian / Ubuntu / Raspberry Pi OS:\n    sudo apt install ${aptPkgs}\n`);
    console.log(`  Arch Linux:\n    sudo pacman -S poppler zip unrar\n`);
    console.log(`  Fedora / RHEL:\n    sudo dnf install poppler-utils zip unrar\n`);
  }

  console.log('These packages are required for:');
  missingPackages.forEach(({ pkg, description }) => {
    console.log(`  - ${pkg}: ${description}`);
  });
  console.log('\nThe app will still run, but PDF/CBR conversion will not work.');
  console.log('See README.md for more information.\n');
} else {
  console.log('\n✅ All system dependencies are installed!\n');
}
