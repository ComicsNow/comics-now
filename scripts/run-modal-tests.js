#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getPythonBin() {
  if (process.env.MODAL_PYTHON_PATH && fs.existsSync(process.env.MODAL_PYTHON_PATH)) {
    return process.env.MODAL_PYTHON_PATH;
  }
  const localCandidates = [
    path.join(__dirname, '../.venv/bin/python3'),
    path.join(__dirname, '../tagger/venv/bin/python3')
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  if (process.env.MODAL_VENV_PATH) {
    const venvBin = path.join(process.env.MODAL_VENV_PATH, 'bin/python3');
    if (fs.existsSync(venvBin)) return venvBin;
  }
  return 'python3';
}

const pythonBin = getPythonBin();
const testsDir = path.join(__dirname, 'modal/tests');
const res = spawnSync(pythonBin, ['-m', 'pytest', testsDir], {
  stdio: 'inherit',
  env: process.env
});

process.exit(res.status ?? 0);
