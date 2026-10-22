/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Reading List Detail UI - Cover view, List view, Edit mode, Read/Resume buttons', () => {
  let sandbox;
  let modal;

  beforeEach(() => {
    const cssPath = path.resolve(__dirname, '../public/style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const styleEl = document.createElement('style');
    styleEl.textContent = cssContent;
    document.head.appendChild(styleEl);

    document.body.innerHTML = `
      <div id="reading-list-modal" class="hidden">
        <div class="bg-gray-800">
          <button id="edit-reading-lists-btn">Edit</button>
          <button id="save-reading-lists-order-btn" class="hidden" hidden>Save</button>
          <button id="cancel-reading-lists-edit-btn" class="hidden" hidden>Cancel</button>
          <div id="reading-lists-overview">
            <div id="reading-lists-container"></div>
          </div>
        </div>
      </div>
    `;
    modal = document.getElementById('reading-list-modal');

    const state = {
      API_BASE_URL: 'http://localhost:3000',
      openComicViewer: jest.fn(),
      closeReadingListModal: jest.fn(),
      downloadedComicIds: new Set(),
      ReadingLists: {
        getReadingListDetails: jest.fn(),
        removeComicsFromList: jest.fn().mockResolvedValue({ ok: true }),
        reorderComics: jest.fn().mockResolvedValue({ ok: true })
      }
    };

    window.openComicViewer = state.openComicViewer;
    window.closeReadingListModal = state.closeReadingListModal;

    sandbox = {
      window,
      document,
      navigator: window.navigator,
      setTimeout,
      clearTimeout,
      rootFolderListContainer: document.createElement('div'),
      state,
      console,
      sessionStorage: {
        _data: {},
        getItem(k) { return this._data[k] ?? null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; },
        clear() { this._data = {}; }
      },
      localStorage: {
        _data: {},
        getItem(k) { return this._data[k] ?? null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; },
        clear() { this._data = {}; }
      },
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      registerRoutes: jest.fn(),
      getRelativePath: jest.fn(() => '/reading-lists'),
      hideAdminUI: jest.fn(),
      renderReadingListDAG: jest.fn(),
      ICONS: { READ: '✓', DOWNLOAD: '⬇', UNREAD: '○' },
      getComicById: jest.fn(id => {
        if (id === 'comic-unread') {
          return { id, name: 'Batman #1', series: 'Batman', totalPages: 30, lastReadPage: 0, thumbnailPath: 'bat1.jpg' };
        }
        if (id === 'comic-in-progress') {
          return { id, name: 'Batman #2', series: 'Batman', totalPages: 30, lastReadPage: 15, thumbnailPath: 'bat2.jpg' };
        }
        if (id === 'comic-read') {
          return { id, name: 'Batman #3', series: 'Batman', totalPages: 30, lastReadPage: 29, thumbnailPath: 'bat3.jpg' };
        }
        return { id, name: `Comic ${id}`, totalPages: 20, lastReadPage: 0 };
      }),
      confirm: jest.fn(() => true),
      alert: jest.fn(),
      fetch: jest.fn()
    };
    sandbox.window.getComicById = sandbox.getComicById;
    sandbox.state.getComicById = sandbox.getComicById;
    sandbox.getOfflineComicRecordById = jest.fn();
    sandbox.applyDisplayInfoToComic = jest.fn(c => ({ displayTitle: c.name, subtitle: '', altText: c.name }));

    sandbox.deleteOfflineComic = jest.fn(id => {
      sandbox.state.downloadedComicIds.delete(id);
      return Promise.resolve();
    });
    sandbox.window.deleteOfflineComic = sandbox.deleteOfflineComic;
    sandbox.state.deleteOfflineComic = sandbox.deleteOfflineComic;

    sandbox.downloadComic = jest.fn().mockResolvedValue(true);
    sandbox.window.downloadComic = sandbox.downloadComic;
    sandbox.state.downloadComic = sandbox.downloadComic;

    vm.createContext(sandbox);

    // Extract showReadingListDetail and related logic from app.js
    const appPath = path.resolve(__dirname, '../public/app.js');
    const appContent = fs.readFileSync(appPath, 'utf8');

    // Clean imports/exports for vm execution
    const cleanContent = appContent
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/import\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');

    vm.runInContext(cleanContent, sandbox);
    sandbox.document.dispatchEvent(new sandbox.window.Event('DOMContentLoaded'));
  });

  const sampleItems = [
    { comicId: 'comic-unread', totalPages: 30, lastReadPage: 0, sortOrder: 0 },
    { comicId: 'comic-in-progress', totalPages: 30, lastReadPage: 15, sortOrder: 1 },
    { comicId: 'comic-read', totalPages: 30, lastReadPage: 29, sortOrder: 2 }
  ];

  it('2 & 5. in Grid (cover) view when not editing: shows mark-as-read and download buttons on covers, read/resume buttons, and clicking cover opens comic instead of deleting', async () => {
    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      id: 'list-1',
      name: 'Batman Run',
      items: sampleItems
    });

    await sandbox.showReadingListDetail('list-1', 'Batman Run', 'detailed');

    const inProgressCard = document.querySelector('[data-comic-id="comic-in-progress"]');
    expect(inProgressCard).not.toBeNull();

    // Mark as read and download buttons must exist on cover
    const markReadBtn = inProgressCard.querySelector('.mark-read-btn');
    const downloadBtn = inProgressCard.querySelector('.download-comic-btn');
    expect(markReadBtn).not.toBeNull();
    expect(downloadBtn).not.toBeNull();

    // When NOT in edit mode, trash icon must NOT exist or be shown
    const trashBtn = inProgressCard.querySelector('.delete-comic-btn');
    if (trashBtn) {
      expect(trashBtn.classList.contains('hidden')).toBe(true);
    } else {
      expect(trashBtn).toBeNull();
    }

    // When comic is in-progress, show Resume button and DO NOT show Read button
    const resumeBtn = inProgressCard.querySelector('.resume-comic-btn');
    const readBtn = inProgressCard.querySelector('.read-comic-btn');
    expect(resumeBtn).not.toBeNull();
    expect(readBtn).toBeNull();

    // Clicking Resume opens reader at current progress
    resumeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.state.openComicViewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'comic-in-progress' }),
      expect.objectContaining({ readingListId: 'list-1' })
    );

    // Clicking on the cover/card directly opens the reader, DOES NOT call delete
    sandbox.state.openComicViewer.mockClear();
    sandbox.state.ReadingLists.removeComicsFromList.mockClear();

    inProgressCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.state.openComicViewer).toHaveBeenCalled();
    expect(sandbox.state.ReadingLists.removeComicsFromList).not.toHaveBeenCalled();
  });

  it('2. in Grid (cover) view when clicking Edit: shows reorder buttons on left and trash icon on top-right which invokes delete', async () => {
    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      id: 'list-1',
      name: 'Batman Run',
      items: sampleItems
    });

    await sandbox.showReadingListDetail('list-1', 'Batman Run', 'detailed');

    const editBtn = document.getElementById('edit-list-btn');
    expect(editBtn).not.toBeNull();
    editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    // Wait for rerender
    await new Promise(r => setTimeout(r, 10));

    const inProgressCard = document.querySelector('[data-comic-id="comic-in-progress"]');
    const upBtn = inProgressCard.querySelector('.reorder-up-btn');
    const downBtn = inProgressCard.querySelector('.reorder-down-btn');
    const trashBtn = inProgressCard.querySelector('.delete-comic-btn');

    expect(upBtn).not.toBeNull();
    expect(downBtn).not.toBeNull();
    expect(trashBtn).not.toBeNull();
    expect(trashBtn.classList.contains('hidden')).toBe(false);

    // Clicking trash button calls delete
    trashBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.state.ReadingLists.removeComicsFromList).toHaveBeenCalledWith('list-1', ['comic-in-progress']);
  });

  it('3. saveorder and cancel buttons ONLY appear when clicking edit', async () => {
    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      id: 'list-1',
      name: 'Batman Run',
      items: sampleItems
    });

    await sandbox.showReadingListDetail('list-1', 'Batman Run', 'detailed');

    const saveOrderBtn = document.getElementById('save-order-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const editBtn = document.getElementById('edit-list-btn');
    const editActionsBar = document.getElementById('reading-list-edit-actions');

    // Save and Cancel must be housed together in the dedicated edit-actions bar on another line
    expect(editActionsBar).not.toBeNull();
    expect(editActionsBar.contains(saveOrderBtn)).toBe(true);
    expect(editActionsBar.contains(cancelEditBtn)).toBe(true);

    // Initially, edit-actions bar, save order, and cancel must be hidden (both class and computed style)
    expect(editActionsBar.classList.contains('hidden')).toBe(true);
    expect(window.getComputedStyle(editActionsBar).display).toBe('none');
    expect(saveOrderBtn.classList.contains('hidden')).toBe(true);
    expect(cancelEditBtn.classList.contains('hidden')).toBe(true);
    expect(window.getComputedStyle(saveOrderBtn).display).toBe('none');
    expect(window.getComputedStyle(cancelEditBtn).display).toBe('none');
    expect(editBtn.classList.contains('hidden')).toBe(false);
    expect(window.getComputedStyle(editBtn).display).not.toBe('none');

    // After clicking edit, save order and cancel appear on their dedicated line
    editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(editActionsBar.classList.contains('hidden')).toBe(false);
    expect(window.getComputedStyle(editActionsBar).display).not.toBe('none');
    expect(saveOrderBtn.classList.contains('hidden')).toBe(false);
    expect(cancelEditBtn.classList.contains('hidden')).toBe(false);
    expect(window.getComputedStyle(saveOrderBtn).display).not.toBe('none');
    expect(window.getComputedStyle(cancelEditBtn).display).not.toBe('none');
    expect(editBtn.classList.contains('hidden')).toBe(true);
    expect(window.getComputedStyle(editBtn).display).toBe('none');

    // After clicking cancel, save order and cancel disappear
    cancelEditBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(editActionsBar.classList.contains('hidden')).toBe(true);
    expect(window.getComputedStyle(editActionsBar).display).toBe('none');
    expect(saveOrderBtn.classList.contains('hidden')).toBe(true);
    expect(cancelEditBtn.classList.contains('hidden')).toBe(true);
    expect(window.getComputedStyle(saveOrderBtn).display).toBe('none');
    expect(window.getComputedStyle(cancelEditBtn).display).toBe('none');
    expect(editBtn.classList.contains('hidden')).toBe(false);
    expect(window.getComputedStyle(editBtn).display).not.toBe('none');
  });

  it('4 & 5. in List view: trash icon ONLY appears when clicking edit, and read/resume buttons are shown when not editing', async () => {
    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      id: 'list-1',
      name: 'Batman Run',
      items: sampleItems
    });

    await sandbox.showReadingListDetail('list-1', 'Batman Run', 'compact');

    const inProgressRow = document.querySelector('[data-comic-id="comic-in-progress"]');
    // Line 1: Name of comic
    const titleEl = inProgressRow.querySelector('.comic-title-line');
    expect(titleEl).not.toBeNull();
    expect(titleEl.textContent).toContain('Batman #2');

    // Line 2: Progress icon, completed icon (if completed), percentage read
    const progressLine = inProgressRow.querySelector('.comic-progress-line');
    expect(progressLine).not.toBeNull();
    expect(progressLine.textContent).toContain('50%');

    // Completed comic row has completed badge in Line 2
    const readRow = document.querySelector('[data-comic-id="comic-read"]');
    expect(readRow).not.toBeNull();
    const completedBadge = readRow.querySelector('.comic-completed-badge');
    expect(completedBadge).not.toBeNull();

    // Line 3: Resume/Read, Mark as read/unread, Download buttons
    const actionLine = inProgressRow.querySelector('.comic-actions-line');
    expect(actionLine).not.toBeNull();

    // In-progress: show Resume button, and DO NOT show Read button
    const resumeBtn = inProgressRow.querySelector('.resume-comic-btn');
    const readBtn = inProgressRow.querySelector('.read-comic-btn');
    expect(resumeBtn).not.toBeNull();
    expect(readBtn).toBeNull();

    // Mark as read and download buttons must appear in Line 3
    const markReadBtn = inProgressRow.querySelector('.mark-read-btn');
    const downloadBtn = inProgressRow.querySelector('.download-comic-btn');
    expect(markReadBtn).not.toBeNull();
    expect(downloadBtn).not.toBeNull();

    // Unread comic shows Read button
    const unreadRow = document.querySelector('[data-comic-id="comic-unread"]');
    expect(unreadRow.querySelector('.read-comic-btn')).not.toBeNull();
    expect(unreadRow.querySelector('.resume-comic-btn')).toBeNull();

    // Now click Edit
    const editBtn = document.getElementById('edit-list-btn');
    editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    await new Promise(r => setTimeout(r, 10));

    const editingRow = document.querySelector('[data-comic-id="comic-in-progress"]');
    const editingTrashBtn = editingRow.querySelector('.delete-comic-btn');
    expect(editingTrashBtn).not.toBeNull();
    expect(editingTrashBtn.classList.contains('hidden')).toBe(false);
    expect(window.getComputedStyle(editingTrashBtn).display).not.toBe('none');
  });

  it('6. segmented view mode controls and back button have streamlined controls without brutalist 3px black offset box shadows or rectangular borders', async () => {
    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      id: 'list-1',
      name: 'Batman Run',
      items: sampleItems
    });

    await sandbox.showReadingListDetail('list-1', 'Batman Run', 'detailed');

    const gridBtn = document.getElementById('view-mode-grid-btn');
    const compactBtn = document.getElementById('view-mode-compact-btn');
    const dagBtn = document.getElementById('view-mode-dag-btn');
    const backBtn = document.getElementById('back-to-lists-btn');

    expect(gridBtn).not.toBeNull();
    expect(compactBtn).not.toBeNull();
    expect(dagBtn).not.toBeNull();
    expect(backBtn).not.toBeNull();

    const gridStyle = window.getComputedStyle(gridBtn);
    const compactStyle = window.getComputedStyle(compactBtn);
    const dagStyle = window.getComputedStyle(dagBtn);
    const backStyle = window.getComputedStyle(backBtn);

    // Segmented buttons must NOT have 3px hard black offset shadows or 2px black borders
    expect(gridStyle.boxShadow).not.toContain('3px 3px');
    expect(compactStyle.boxShadow).not.toContain('3px 3px');
    expect(dagStyle.boxShadow).not.toContain('3px 3px');
    expect(gridStyle.border).not.toContain('2px solid');

    // Back button must be circular (9999px border-radius) and not have 4px rectangular border-radius
    expect(backStyle.borderRadius).toBe('9999px');
  });

  it('7. download button acts like card buttons: shows green tick when downloaded, confirms deletion from device on click without altering list/progress, and removes redundant downloaded badges', async () => {
    // Set comic-in-progress as downloaded
    sandbox.state.downloadedComicIds = new Set(['comic-in-progress']);
    sandbox.window.downloadedComicIds = sandbox.state.downloadedComicIds;

    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      id: 'list-1',
      name: 'Batman Run',
      items: sampleItems
    });

    // 1) Test in List view (compact)
    await sandbox.showReadingListDetail('list-1', 'Batman Run', 'compact');

    const inProgressRow = document.querySelector('[data-comic-id="comic-in-progress"]');
    expect(inProgressRow).not.toBeNull();

    // Verify first line (title line) does NOT have redundant "Downloaded" badge
    const titleLine = inProgressRow.querySelector('.comic-title-line');
    expect(titleLine.textContent).not.toContain('Downloaded');
    expect(titleLine.querySelector('[title="Downloaded"]')).toBeNull();

    // Verify third line download button on downloaded comic
    const downloadedBtn = inProgressRow.querySelector('.download-comic-btn');
    expect(downloadedBtn).not.toBeNull();
    expect(downloadedBtn.dataset.isDownloaded).toBe('true');
    expect(downloadedBtn.classList.contains('text-green-400')).toBe(true);
    expect(downloadedBtn.textContent).toContain('✓');
    expect(downloadedBtn.getAttribute('title')).toMatch(/delete/i);

    // Verify download button on NOT downloaded comic (comic-unread)
    const unreadRow = document.querySelector('[data-comic-id="comic-unread"]');
    const unreadDownloadBtn = unreadRow.querySelector('.download-comic-btn');
    expect(unreadDownloadBtn.dataset.isDownloaded).toBe('false');
    expect(unreadDownloadBtn.classList.contains('text-green-400')).toBe(false);
    expect(unreadDownloadBtn.textContent).toContain('⬇');

    // Click download button on downloaded comic in list view
    downloadedBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.confirm).toHaveBeenCalledWith(expect.stringContaining('Batman #2'));
    expect(sandbox.deleteOfflineComic).toHaveBeenCalledWith('comic-in-progress');
    // Ensure ReadingLists.removeComicsFromList was NEVER called
    expect(sandbox.state.ReadingLists.removeComicsFromList).not.toHaveBeenCalled();

    // Await async delete and renderComics in click handler to complete
    await new Promise(r => setTimeout(r, 20));

    // 2) Test in Grid view (detailed)
    sandbox.state.downloadedComicIds = new Set(['comic-in-progress']);
    sandbox.window.downloadedComicIds = sandbox.state.downloadedComicIds;
    sandbox.confirm.mockClear();
    sandbox.deleteOfflineComic.mockClear();

    await sandbox.showReadingListDetail('list-1', 'Batman Run', 'detailed');

    const inProgressCard = document.querySelector('[data-comic-id="comic-in-progress"]');
    expect(inProgressCard).not.toBeNull();

    // Verify redundant bottom-right download indicator is removed from card
    expect(inProgressCard.querySelector('.bottom-2.right-2[title="Downloaded"]')).toBeNull();

    // Verify download button on cover
    const cardDownloadBtn = inProgressCard.querySelector('.download-comic-btn');
    expect(cardDownloadBtn).not.toBeNull();
    expect(cardDownloadBtn.dataset.isDownloaded).toBe('true');
    expect(cardDownloadBtn.classList.contains('text-green-400')).toBe(true);
    expect(cardDownloadBtn.textContent).toContain('✓');
    expect(cardDownloadBtn.getAttribute('title')).toMatch(/delete/i);

    // Clicking it prompts delete confirmation and deletes from offline DB
    cardDownloadBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.confirm).toHaveBeenCalledWith(expect.stringContaining('Batman #2'));
    expect(sandbox.deleteOfflineComic).toHaveBeenCalledWith('comic-in-progress');
    expect(sandbox.state.ReadingLists.removeComicsFromList).not.toHaveBeenCalled();

    // Verify un-downloaded comic in grid view
    const unreadCard = document.querySelector('[data-comic-id="comic-unread"]');
    const cardUnreadDownloadBtn = unreadCard.querySelector('.download-comic-btn');
    expect(cardUnreadDownloadBtn.dataset.isDownloaded).toBe('false');
    expect(cardUnreadDownloadBtn.classList.contains('text-green-400')).toBe(false);
    expect(cardUnreadDownloadBtn.textContent).toContain('⬇');

    cardUnreadDownloadBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.downloadComic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'comic-unread' }),
      cardUnreadDownloadBtn
    );
  });

  it('8. reading list card action buttons (Read, DAG, Save, Start) have consistent uniform height, sizing, and icon dimensions', async () => {
    sandbox.state.ReadingLists.fetchReadingLists = jest.fn().mockResolvedValue([
      {
        id: 'list-1',
        name: 'Bad Idea: Hank Howard',
        created: '2026-10-14T00:00:00.000Z',
        readComics: 0,
        totalComics: 7,
        progressPercent: 0,
        seriesCount: 5,
        description: 'Offbeat comedy-noir'
      }
    ]);

    await sandbox.refreshReadingListModal();

    const card = document.querySelector('#reading-lists-container [data-list-id="list-1"]');
    expect(card).not.toBeNull();

    const readBtn = card.querySelector('.read-toggle-btn');
    const dagBtn = card.querySelector('.dag-list-btn');
    const downloadBtn = card.querySelector('.download-list-btn');
    const playBtn = card.querySelector('.play-list-btn');

    expect(readBtn).not.toBeNull();
    expect(dagBtn).not.toBeNull();
    expect(downloadBtn).not.toBeNull();
    expect(playBtn).not.toBeNull();

    // Text must be present and visible without .truncate truncation
    expect(readBtn.textContent).toContain('Read');
    expect(dagBtn.textContent).toContain('DAG');
    expect(downloadBtn.textContent).toContain('Save');
    expect(playBtn.textContent).toContain('Start');
    expect(card.querySelector('.read-toggle-btn .truncate')).toBeNull();
    expect(card.querySelector('.dag-list-btn .truncate')).toBeNull();
    expect(card.querySelector('.download-list-btn .truncate')).toBeNull();
    expect(card.querySelector('.play-list-btn .truncate')).toBeNull();

    // Check computed styles on initial card
    const readStyle = window.getComputedStyle(readBtn);
    const dagStyle = window.getComputedStyle(dagBtn);
    const downloadStyle = window.getComputedStyle(downloadBtn);
    const playStyle = window.getComputedStyle(playBtn);

    // Height should be identical across all 4 buttons (38px)
    expect(readStyle.height).toBe('38px');
    expect(dagStyle.height).toBe('38px');
    expect(downloadStyle.height).toBe('38px');
    expect(playStyle.height).toBe('38px');

    // SVG icons inside read-toggle-btn and download-list-btn must be constrained to 14px
    const readSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    readBtn.appendChild(readSvg);
    const downloadSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    downloadBtn.appendChild(downloadSvg);

    const readSvgStyle = window.getComputedStyle(readSvg);
    const downloadSvgStyle = window.getComputedStyle(downloadSvg);
    expect(readSvgStyle.width).toBe('14px');
    expect(readSvgStyle.height).toBe('14px');
    expect(downloadSvgStyle.width).toBe('14px');
    expect(downloadSvgStyle.height).toBe('14px');

    // 1) When NOT in edit mode: delete button must be HIDDEN
    const deleteBtn = card.querySelector('.delete-list-btn');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn.classList.contains('hidden')).toBe(true);

    // 2) When clicking Edit: delete button must be VISIBLE
    const editBtn = document.getElementById('edit-reading-lists-btn');
    expect(editBtn).not.toBeNull();
    editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    await new Promise(r => setTimeout(r, 20));

    const editingCard = document.querySelector('#reading-lists-container [data-list-id="list-1"]');
    const editingDeleteBtn = editingCard.querySelector('.delete-list-btn');
    expect(editingDeleteBtn).not.toBeNull();
    expect(editingDeleteBtn.classList.contains('hidden')).toBe(false);

    // 3) In-progress reading list shows Resume button with flex-1 min-w-0 without overflowing
    sandbox.state.ReadingLists.fetchReadingLists = jest.fn().mockResolvedValue([
      {
        id: 'list-in-progress',
        name: 'DC Event: The Metal Saga',
        created: '2026-09-21T00:00:00.000Z',
        readComics: 1,
        totalComics: 8,
        progressPercent: 13,
        seriesCount: 8
      }
    ]);

    await sandbox.refreshReadingListModal();
    const inProgressListCard = document.querySelector('#reading-lists-container [data-list-id="list-in-progress"]');
    expect(inProgressListCard).not.toBeNull();
    const resumeBtn = inProgressListCard.querySelector('.play-list-btn');
    expect(resumeBtn).not.toBeNull();
    expect(resumeBtn.textContent).toContain('Resume');
    expect(resumeBtn.classList.contains('flex-1')).toBe(true);
    expect(resumeBtn.classList.contains('min-w-0')).toBe(true);
  });

  it('9. isolates detail view by hiding overview controls and unhiding on back, and unifies detail toolbar secondary buttons', async () => {
    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      id: 'list-1',
      name: 'Batman Run',
      items: sampleItems
    });

    const overview = document.getElementById('reading-lists-overview');
    expect(overview).not.toBeNull();
    expect(overview.classList.contains('hidden')).toBe(false);

    await sandbox.showReadingListDetail('list-1', 'Batman Run', 'detailed');

    // Overview controls must be hidden when entering detail view
    expect(overview.classList.contains('hidden')).toBe(true);

    // Detail view secondary buttons styling
    const downloadBtn = document.getElementById('download-all-list-btn');
    const exportBtn = document.getElementById('export-list-btn');
    const editBtn = document.getElementById('edit-list-btn');

    expect(downloadBtn).not.toBeNull();
    expect(exportBtn).not.toBeNull();
    expect(editBtn).not.toBeNull();

    // Secondary buttons must use unified gray styling rather than clashing individual colors
    expect(downloadBtn.className).toContain('bg-gray-700');
    expect(downloadBtn.className).not.toContain('bg-purple-600');
    expect(exportBtn.className).toContain('bg-gray-700');
    expect(exportBtn.className).not.toContain('bg-blue-600');
    expect(editBtn.className).toContain('bg-gray-700');

    // Clicking back button restores overview controls and removes detail view
    const backBtn = document.getElementById('back-to-lists-btn');
    expect(backBtn).not.toBeNull();
    backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(overview.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('reading-list-detail-view')).toBeNull();
  });

  it('10. reading list overview modal and tag comics now modal markup structure in index.html', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');

    // Reading lists overview container exists and wraps export/import buttons in a 2-column secondary grid
    expect(html).toContain('id="reading-lists-overview"');
    expect(html).toMatch(/<button id="export-all-lists-btn"[^>]*>[\s\S]*?<button id="import-lists-btn"/);
    expect(html).toContain('grid grid-cols-2');

    // Tag Comics Now button palette:
    // Hero action: ct-run-btn is blue
    expect(html).toMatch(/id="ct-run-btn"[^>]*class="[^"]*bg-blue-600/);

    // Secondary modifiers: ct-rescan-unmatched-btn & ct-rescan-xml-btn are NOT loud amber/purple backgrounds
    expect(html).not.toMatch(/id="ct-rescan-unmatched-btn"[^>]*class="[^"]*bg-amber-600/);
    expect(html).not.toMatch(/id="ct-rescan-xml-btn"[^>]*class="[^"]*bg-purple-600/);
    expect(html).toMatch(/id="ct-rescan-unmatched-btn"[^>]*class="[^"]*bg-gray-800/);
    expect(html).toMatch(/id="ct-rescan-xml-btn"[^>]*class="[^"]*bg-gray-800/);

    // Subtle clear button
    expect(html).toMatch(/id="ct-clear-output"[^>]*class="[^"]*bg-gray-800[^"]*text-gray-400/);
  });
});

