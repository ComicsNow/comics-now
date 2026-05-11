/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

describe('Metadata Restriction', () => {
    let hideAdminUI;

    beforeAll(() => {
        const appJsPath = path.join(__dirname, '../public/app.js');
        const appJs = fs.readFileSync(appJsPath, 'utf8');
        // Extract hideAdminUI function
        const startIdx = appJs.indexOf('function hideAdminUI() {');
        if (startIdx === -1) throw new Error('hideAdminUI not found');
        
        let braceCount = 0;
        let endIdx = -1;
        for (let i = startIdx; i < appJs.length; i++) {
            if (appJs[i] === '{') braceCount++;
            else if (appJs[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                    endIdx = i + 1;
                    break;
                }
            }
        }
        
        const functionStr = appJs.substring(startIdx, endIdx);
        // Create function and run it
        hideAdminUI = new Function('return ' + functionStr)();
    });

    test('hideAdminUI removes metadata-tab and metadata-content for non-admin users', () => {
        document.body.innerHTML = `
            <button id="metadata-tab">Metadata</button>
            <div id="metadata-content"></div>
            <button id="ct-button">CT</button>
        `;

        window.syncManager = {
            authEnabled: true,
            userRole: 'user'
        };

        hideAdminUI();

        // This is expected to FAIL initially
        expect(document.getElementById('metadata-tab')).toBeNull();
        expect(document.getElementById('metadata-content')).toBeNull();
    });

    test('hideAdminUI keeps metadata-tab for admin users', () => {
        document.body.innerHTML = `
            <button id="metadata-tab">Metadata</button>
            <div id="metadata-content"></div>
        `;

        window.syncManager = {
            authEnabled: true,
            userRole: 'admin'
        };

        hideAdminUI();

        expect(document.getElementById('metadata-tab')).not.toBeNull();
        expect(document.getElementById('metadata-content')).not.toBeNull();
    });
});
