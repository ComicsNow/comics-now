const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

describe('package engines', () => {
    test('declared Node engine matches the installed Vite build requirement', () => {
        const pkg = readJson('package.json');
        const vite = readJson('node_modules/vite/package.json');

        expect(pkg.engines).toBeDefined();
        expect(pkg.engines.node).toBe(vite.engines.node);
    });

    test('lockfile root engines stay in sync with package.json', () => {
        const pkg = readJson('package.json');
        const lock = readJson('package-lock.json');

        expect(lock.packages[''].engines.node).toBe(pkg.engines.node);
    });
});
