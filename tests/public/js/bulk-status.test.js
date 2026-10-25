/**
 * @jest-environment jsdom
 */

import { open, close } from '../../../public/js/bulk-status.js';
import { state } from '../../../public/js/globals.js';

// Mock dependencies
jest.mock('../../../public/js/globals.js', () => ({
  state: {
    API_BASE_URL: 'http://localhost:3000',
    library: {},
    updateLibraryReadStatus: jest.fn(),
    applyFilterAndRender: jest.fn()
  }
}));

describe('bulk-status.js', () => {
  let alertSpy;
  let fetchSpy;
  let applyFilterAndRenderSpy;
  let updateLibraryReadStatusSpy;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = '';

    // Setup Mocks
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    window.fetch = jest.fn().mockImplementation(() => Promise.resolve({ ok: true }));
    fetchSpy = window.fetch;

    state.API_BASE_URL = 'http://localhost:3000';
    state.library = {};
    state.applyFilterAndRender = jest.fn();
    state.updateLibraryReadStatus = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('open() shows alert when comics array is empty', () => {
    open([], 'selection');
    expect(alertSpy).toHaveBeenCalledWith('No comics in this selection.');
  });

  test('open() shows alert when comics is not an array', () => {
    open(null, 'selection');
    expect(alertSpy).toHaveBeenCalledWith('No comics in this selection.');
  });

  test('open() builds modal and calculates correct counts', () => {
    const comics = [
      { id: 1, progress: { totalPages: 10, lastReadPage: 9 } }, // read
      { id: 2, progress: { totalPages: 10, lastReadPage: 1 } }, // in-progress
      { id: 3, progress: { totalPages: 10, lastReadPage: 0 } }, // unread
      { id: 4 } // unread
    ];

    open(comics, 'My Series');

    const backdrop = document.getElementById('bulk-status-modal');
    expect(backdrop).not.toBeNull();
    expect(backdrop.classList.contains('hidden')).toBe(false);

    const scopeEl = document.getElementById('bulk-status-scope');
    expect(scopeEl.textContent).toBe('4 comics in My Series.');

    const countsEl = document.getElementById('bulk-status-counts');
    const html = countsEl.innerHTML;
    // read=1, in-progress=1, unread=2
    expect(html).toContain('1</div><div>Read');
    expect(html).toContain('1</div><div>In progress');
    expect(html).toContain('2</div><div>Unread');
  });

  test('close() hides the modal', () => {
    const comics = [{ id: 1, progress: { totalPages: 10, lastReadPage: 0 } }];
    open(comics, 'selection');

    const backdrop = document.getElementById('bulk-status-modal');
    expect(backdrop.classList.contains('hidden')).toBe(false);

    close();

    expect(backdrop.classList.contains('hidden')).toBe(true);
  });

  test('clicking Mark all Read updates statuses, calls API, and invalidates cache', async () => {
    // Setup mock library with counts
    state.library = {
      'root1': {
        publishers: {
          'Pub1': {
            _counts: { total: 1 },
            series: {
              'Series1': {
                _counts: { total: 1 },
                0: { id: 1 },
                length: 1,
                push: jest.fn(),
                forEach: Array.prototype.forEach,
                map: Array.prototype.map,
                some: Array.prototype.some
              }
            }
          }
        }
      }
    };
    // Proper array mocking for logic in bulk-status
    state.library['root1'].publishers['Pub1'].series['Series1'] = [
      { id: 1 }
    ];
    state.library['root1'].publishers['Pub1'].series['Series1']._counts = { total: 1 };

    const comics = [{ id: 1 }];
    open(comics, 'selection');

    const readBtn = document.getElementById('bulk-status-mark-read');

    // Simulate click
    await new Promise((resolve) => {
      readBtn.addEventListener('click', () => {
        setTimeout(resolve, 0); // let async handler finish
      });
      readBtn.click();
    });

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3000/api/v1/comics/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comicId: 1, status: 'read' })
    });

    expect(state.updateLibraryReadStatus).toHaveBeenCalledWith({ comicId: 1, status: 'read' });
    expect(state.applyFilterAndRender).toHaveBeenCalled();

    const backdrop = document.getElementById('bulk-status-modal');
    expect(backdrop.classList.contains('hidden')).toBe(true);

    // Verify cache invalidation
    expect(state.library['root1'].publishers['Pub1']._counts).toBeUndefined();
    expect(state.library['root1'].publishers['Pub1'].series['Series1']._counts).toBeUndefined();
  });

  test('clicking Mark all Unread updates statuses and handles API errors gracefully', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const comics = [{ id: 1 }, { id: 2 }];
    open(comics, 'selection');

    const unreadBtn = document.getElementById('bulk-status-mark-unread');

    await new Promise((resolve) => {
      unreadBtn.addEventListener('click', () => {
        setTimeout(resolve, 0); // let async handler finish
      });
      unreadBtn.click();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3000/api/v1/comics/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comicId: 1, status: 'unread' })
    });

    expect(state.applyFilterAndRender).toHaveBeenCalled();
  });
});
