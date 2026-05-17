/**
 * @jest-environment jsdom
 */

// Mock global functions used in public/app.js before requiring it
global.openOfflineDB = jest.fn().mockResolvedValue(null);
global.escapeHtml = jest.fn(str => str);
global.initializeApp = jest.fn();

describe('Metadata Restriction', () => {
    const { hideAdminUI } = require('../public/app.js');

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
