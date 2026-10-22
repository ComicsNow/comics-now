/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClientScript(filepath, sandbox) {
  const fileContent = fs.readFileSync(filepath, 'utf8');
  const cleanContent = fileContent
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/\bexport\s+/g, '')
    + '\nwindow.renderMetadataDisplay = renderMetadataDisplay;\nwindow.sanitizeMetadata = sanitizeMetadata;\n';
  const script = new vm.Script(cleanContent);
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  return sandbox;
}

describe('Frontend Metadata Display - Canonical Key Deduplication', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = `
      <form id="metadata-form">
        <div id="save-status"></div>
      </form>
    `;

    sandbox = {
      window: {
        syncManager: { userRole: 'admin' },
        currentMetadata: {},
        metadataForm: document.getElementById('metadata-form')
      },
      document,
      console,
      state: {
        syncManager: { userRole: 'admin' },
        metadataHasUnsavedChanges: false,
        metadataForm: document.getElementById('metadata-form')
      },
      escapeHtml: (s) => String(s || '')
    };
  });

  it('deduplicates dual-cased metadata so only canonical PascalCase inputs are rendered', () => {
    loadClientScript(path.join(__dirname, '../public/js/metadata.js'), sandbox);

    const dualCasedData = {
      // PascalCase
      Title: 'The Phantom Stranger',
      Series: 'The Phantom Stranger Omnibus',
      Number: '1',
      Publisher: 'DC Comics',
      Writer: 'John Broome',
      Summary: 'The greatest supernatural adventures.',
      Year: '2023',
      CoverDate: '2023-08',
      // Lowercase / snake_case duplicates
      title: 'The Phantom Stranger',
      series: 'The Phantom Stranger Omnibus',
      number: '1',
      issue: '1',
      issue_number: '1',
      issue_title: 'The Phantom Stranger',
      publisher: 'DC Comics',
      writer: 'John Broome',
      description: 'The greatest supernatural adventures.',
      summary: 'The greatest supernatural adventures.',
      year: '2023',
      cover_date: '2023-08',
      publish_date: '2023-08'
    };

    sandbox.window.renderMetadataDisplay(dualCasedData, true);

    const form = document.getElementById('metadata-form');

    // Canonical fields should exist
    expect(form.querySelector('[name="Series"]')).not.toBeNull();
    expect(form.querySelector('[name="Number"]')).not.toBeNull();
    expect(form.querySelector('[name="Publisher"]')).not.toBeNull();
    expect(form.querySelector('[name="Writer"]')).not.toBeNull();
    expect(form.querySelector('[name="Summary"]')).not.toBeNull();

    // Duplicate lowercase fields MUST NOT exist in the form
    expect(form.querySelector('[name="series"]')).toBeNull();
    expect(form.querySelector('[name="title"]')).toBeNull();
    expect(form.querySelector('[name="number"]')).toBeNull();
    expect(form.querySelector('[name="issue"]')).toBeNull();
    expect(form.querySelector('[name="issue_number"]')).toBeNull();
    expect(form.querySelector('[name="issue_title"]')).toBeNull();
    expect(form.querySelector('[name="publisher"]')).toBeNull();
    expect(form.querySelector('[name="writer"]')).toBeNull();
    expect(form.querySelector('[name="description"]')).toBeNull();
    expect(form.querySelector('[name="summary"]')).toBeNull();
    expect(form.querySelector('[name="year"]')).toBeNull();
    expect(form.querySelector('[name="cover_date"]')).toBeNull();
    expect(form.querySelector('[name="publish_date"]')).toBeNull();
  });
});
