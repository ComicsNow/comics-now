# Continuous Mode Implementation Plan

## Overview
Add vertical continuous scroll mode to the comic viewer, allowing users to scroll through all pages like a webtoon/manga reader site.

## User Requirements
- **Mode Type**: Vertical scroll through all pages stacked vertically
- **Toggle Locations**: All locations (normal viewer toolbar, fullscreen viewer, settings/preferences, per-comic setting)
- **Manga Mode Interaction**: No effect on continuous mode (manga mode and continuous mode are independent)
- **Page Loading**: Use existing lazy load logic (IntersectionObserver)

## Technical Architecture

### 1. Database Changes

#### 1.1 User Settings Table
- Add `continuousModeDefault` column to `user_settings` table (INTEGER/boolean, default: 0/false)
- Store user's default preference for continuous mode across all comics

#### 1.2 User Comic Status Table
- Add `continuousMode` column to `user_comic_status` table (INTEGER/boolean, nullable)
- Store per-comic continuous mode override (NULL = use user's default setting)

#### Migration SQL:
```sql
-- In server/db.js, add to migrations section
ALTER TABLE user_settings ADD COLUMN continuousModeDefault INTEGER DEFAULT 0;
ALTER TABLE user_comic_status ADD COLUMN continuousMode INTEGER;
```

### 2. Backend API Changes

#### 2.1 New Endpoints
**File**: `server/routes/api.js`

1. **GET /api/v1/continuous-mode-preference**
   - Returns user's default continuous mode setting
   - Response: `{ continuousMode: boolean }`
   - Usage: Load user preference on app init

2. **POST /api/v1/comics/continuous-mode**
   - Toggle continuous mode for specific comic (per-user)
   - Request: `{ comicId: string, continuousMode: boolean }`
   - Response: `{ ok: true, continuousMode: boolean }`
   - Updates `user_comic_status` table

3. **POST /api/v1/comics/set-all-continuous-mode**
   - Bulk set continuous mode at hierarchy level
   - Request: `{ level: 'library'|'publisher'|'series', target: {...}, continuousMode: boolean }`
   - Response: `{ ok: true, updated: number }`
   - For context menu bulk operations

#### 2.2 Update Existing Endpoints
- Modify `/api/v1/comics` (library endpoint) to include `continuousMode` in comic metadata
- Modify `/api/v1/comics/info` to return continuous mode status for the comic
- Ensure per-user continuous mode is queried from `user_comic_status`

### 3. Frontend UI Changes

#### 3.1 HTML Structure
**File**: `public/index.html`

1. **Normal Viewer Toolbar** (around line 682, next to `manga-mode-btn`)
   ```html
   <button id="continuous-mode-btn" class="continuous-mode-btn" title="Toggle Continuous Mode">
     Continuous
   </button>
   ```

2. **Fullscreen Viewer Controls** (around line 478, next to `fullscreen-manga-mode-btn`)
   ```html
   <button
     id="fullscreen-continuous-mode-btn"
     class="continuous-mode-btn"
     title="Toggle Continuous Mode">
     Continuous
   </button>
   ```

3. **Settings Tab - Comics Defaults Section**
   ```html
   <div class="flex items-center justify-between py-2">
     <div>
       <span class="text-sm font-medium">Default Continuous Mode</span>
       <p class="text-xs text-gray-400">Enable vertical scroll by default for new comics</p>
     </div>
     <label class="toggle-switch">
       <input type="checkbox" id="continuous-mode-default-toggle">
       <span class="toggle-slider"></span>
     </label>
   </div>
   ```

4. **New Continuous Viewer Container** (add after `viewer-pages` div)
   ```html
   <div id="viewer-pages-continuous" class="hidden overflow-y-auto max-h-screen">
     <!-- Pages will be dynamically inserted here -->
   </div>
   ```

#### 3.2 CSS Styling
**File**: `public/styles.css`

```css
/* Continuous mode button styling */
.continuous-mode-btn {
  padding: 0.5rem 1rem;
  background-color: rgb(55, 65, 81); /* bg-gray-700 */
  color: white;
  border-radius: 0.5rem;
  transition: background-color 0.2s;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
}

.continuous-mode-btn:hover {
  background-color: rgb(75, 85, 99); /* bg-gray-600 */
}

.continuous-mode-btn.active {
  background-color: rgb(147, 51, 234); /* purple-600 */
  color: white;
}

/* Continuous viewer container */
#viewer-pages-continuous {
  display: flex;
  flex-direction: column;
  gap: 0;
  align-items: center;
  padding: 1rem 0;
  background-color: rgb(17, 24, 39); /* bg-gray-900 */
}

/* Page containers in continuous mode */
#viewer-pages-continuous .page-container {
  width: 100%;
  display: flex;
  justify-content: center;
  min-height: 200px;
}

/* Page images in continuous mode */
#viewer-pages-continuous img {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Loading placeholder for lazy-loaded pages */
#viewer-pages-continuous .page-placeholder {
  width: 100%;
  max-width: 48rem; /* max-w-2xl */
  height: 24rem; /* h-96 */
  background-color: rgb(55, 65, 81); /* bg-gray-700 */
  border-radius: 0.5rem;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
```

### 4. Frontend JavaScript Implementation

#### 4.1 New Module: `public/js/continuous.js`
Create comprehensive continuous mode module with:

**State Management:**
- `isContinuousMode`: Boolean flag for current mode
- `continuousContainer`: Reference to container element
- `pageElements`: Map of page name to img element
- `intersectionObserver`: IntersectionObserver instance
- `loadedPages`: Set of already-loaded page names

**Core Functions:**

```javascript
// Initialize IntersectionObserver for lazy loading
function initIntersectionObserver()

// Load individual page when it enters viewport
async function loadPage(pageName, container)

// Render all pages in continuous mode
async function renderContinuousMode()

// Switch to continuous mode
async function enableContinuousMode()

// Switch back to page-by-page mode
async function disableContinuousMode()

// Track scroll position and update current page
function setupScrollProgressTracking()
function updateCurrentPageFromScroll()

// UI helpers
function hideNavigationButtons()
function showNavigationButtons()
function updateContinuousModeUI(isActive)

// API integration
async function toggleContinuousMode(comicId, currentMode)
async function updateContinuousModeInCache(comicId, continuousMode)

// Button handlers
function setupContinuousModeButtonHandler(button)
function initializeContinuousMode()
```

**Key Implementation Details:**
- Use IntersectionObserver with 500px rootMargin for smooth preloading
- Reuse existing `getPageUrl()` function for consistency
- Update `global.currentPageIndex` based on scroll position
- Call `global.updateViewerPageCounter()` to keep UI in sync
- Handle both online and offline comics
- Update downloaded comics in IndexedDB when toggled

#### 4.2 Integration with Viewer
**File**: `public/js/viewer/navigation.js`

In `openComicViewer()` function (around line 254, after `updateMangaModeUI` call):

```javascript
// Initialize continuous mode if enabled for this comic
if (comic.continuousMode && typeof global.enableContinuousMode === 'function') {
  await global.enableContinuousMode();
} else {
  // Ensure continuous mode is disabled and UI reflects that
  if (typeof global.disableContinuousMode === 'function' && global.isContinuousMode) {
    await global.disableContinuousMode();
  }
  if (typeof global.updateContinuousModeUI === 'function') {
    global.updateContinuousModeUI(false);
  }
}
```

#### 4.3 Settings Page Integration
**File**: `public/js/settings.js`

Add functions for continuous mode default setting:

```javascript
// Load user's default continuous mode preference
async function loadContinuousModeDefault() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/continuous-mode-preference`);
    const data = await response.json();
    const toggle = document.getElementById('continuous-mode-default-toggle');
    if (toggle) {
      toggle.checked = data.continuousMode || false;
    }
  } catch (error) {
    console.error('Failed to load continuous mode default:', error);
  }
}

// Save user's default continuous mode preference
async function saveContinuousModeDefault(enabled) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/continuous-mode-preference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ continuousMode: enabled })
    });

    if (!response.ok) {
      throw new Error('Failed to save preference');
    }

    showSettingsMessage('Continuous mode default updated', 'success');
  } catch (error) {
    console.error('Failed to save continuous mode default:', error);
    showSettingsMessage('Failed to update continuous mode default', 'error');
  }
}

// Setup toggle event listener
const continuousModeToggle = document.getElementById('continuous-mode-default-toggle');
if (continuousModeToggle) {
  continuousModeToggle.addEventListener('change', (e) => {
    saveContinuousModeDefault(e.target.checked);
  });
}

// Call loadContinuousModeDefault() in initializeSettings()
```

### 5. Context Menu Integration
**File**: `public/js/context-menu/menu-builder.js`

Add continuous mode options to all context menus:

**Comic Card Menu:**
```javascript
{
  label: comic.continuousMode ? 'Disable Continuous Mode' : 'Enable Continuous Mode',
  icon: '📜',
  action: async () => {
    // Toggle continuous mode for this specific comic
    await toggleContinuousMode(comic.id, comic.continuousMode || false);
  }
}
```

**Series Card Menu:**
```javascript
{
  label: 'Set to Continuous Mode',
  icon: '📜',
  action: async () => {
    // Bulk enable continuous mode for all comics in series
    await setAllContinuousMode('series', { rootFolder, publisher, seriesName }, true);
  }
},
{
  label: 'Remove Continuous Mode',
  icon: '📄',
  action: async () => {
    // Bulk disable continuous mode for all comics in series
    await setAllContinuousMode('series', { rootFolder, publisher, seriesName }, false);
  }
}
```

**Publisher Card Menu:** (similar pattern)
**Library Card Menu:** (similar pattern)

### 6. Downloaded Comics Integration
**File**: `public/js/library/smartlists.js`

In `rebuildDownloadedComics()` function, after manga mode sync (around line 258):

```javascript
// Sync continuous mode from library if available (similar to manga mode sync)
if (libraryComic && libraryComic.continuousMode !== undefined) {
  baseComic.continuousMode = libraryComic.continuousMode;
}
```

This ensures downloaded comics maintain continuous mode setting consistency across views.

### 7. Global Variables Export
**File**: `public/js/globals.js`

Add continuous mode state to global exports (around line 455-477):

```javascript
window.isContinuousMode = isContinuousMode || false;
window.continuousContainer = continuousContainer || null;
```

### 8. Script Loading Order
**File**: `public/index.html`

Add continuous.js script tag after viewer.js and manga.js:

```html
<script src="js/viewer.js"></script>
<script src="js/manga.js"></script>
<script src="js/continuous.js"></script>
```

## Testing Checklist

### Functionality Tests
- [ ] Normal viewer continuous mode button toggles correctly
- [ ] Fullscreen viewer continuous mode button toggles correctly
- [ ] Settings default continuous mode persists after page reload
- [ ] Per-comic continuous mode persists after closing/reopening comic
- [ ] Per-comic setting overrides user default
- [ ] Lazy loading loads pages as they enter viewport
- [ ] Scroll progress tracking updates page counter accurately
- [ ] Navigation buttons hide when continuous mode active
- [ ] Navigation buttons show when continuous mode disabled

### Integration Tests
- [ ] Works with downloaded comics (offline)
- [ ] Works with online comics (from server)
- [ ] Manga mode and continuous mode work independently (no interference)
- [ ] Context menu bulk operations work (series/publisher/library level)
- [ ] Mode switches correctly between page-by-page and continuous
- [ ] Switching comics preserves correct mode for each comic

### Data Persistence Tests
- [ ] Continuous mode setting saves to database
- [ ] Cache updates work correctly in IndexedDB
- [ ] Downloaded comics sync continuous mode from library
- [ ] Multi-user support (per-user preferences work independently)
- [ ] Settings sync across devices (if authenticated)

### Performance Tests
- [ ] Lazy loading performs smoothly on large comics (100+ pages)
- [ ] Memory usage stays reasonable (old pages get garbage collected)
- [ ] Scroll tracking doesn't cause lag (properly debounced)
- [ ] No unnecessary re-renders when scrolling

### Edge Cases
- [ ] Works with single-page comics
- [ ] Works with very large comics (500+ pages)
- [ ] Handles image load failures gracefully
- [ ] Works when switching between comics rapidly
- [ ] Works in fullscreen mode
- [ ] Works when browser is offline then comes back online

## Implementation Order

### Phase 1: Database & Backend (Day 1)
1. Add database columns to `user_settings` and `user_comic_status`
2. Write migration code in `server/db.js`
3. Implement API endpoints in `server/routes/api.js`:
   - GET `/api/v1/continuous-mode-preference`
   - POST `/api/v1/comics/continuous-mode`
   - POST `/api/v1/comics/set-all-continuous-mode`
4. Update existing endpoints to include `continuousMode` in responses
5. Test API with curl/Postman

### Phase 2: Core Continuous Mode Module (Day 2)
1. Create `public/js/continuous.js`
2. Implement IntersectionObserver setup
3. Implement `renderContinuousMode()` with lazy loading
4. Implement `enableContinuousMode()` and `disableContinuousMode()`
5. Implement scroll progress tracking
6. Test basic rendering with console logs

### Phase 3: UI Integration (Day 3)
1. Add HTML elements to `public/index.html`:
   - Continuous mode buttons (normal + fullscreen)
   - Continuous viewer container
2. Add CSS styling to `public/styles.css`
3. Wire up button click handlers
4. Implement UI update functions
5. Test toggle functionality in browser

### Phase 4: Viewer Integration (Day 4)
1. Integrate with `viewer/navigation.js`
2. Handle mode initialization on comic open
3. Handle mode switching during reading
4. Update progress tracking to work with continuous mode
5. Test with various comic types and sizes

### Phase 5: Settings & Persistence (Day 5)
1. Add settings UI to Settings tab
2. Implement settings load/save functions in `settings.js`
3. Implement cache update functions
4. Test default preference persistence
5. Test per-comic preference persistence

### Phase 6: Context Menu & Bulk Operations (Day 6)
1. Add continuous mode options to context menus
2. Implement bulk operation functions
3. Test hierarchy operations (comic/series/publisher/library)
4. Verify UI updates after bulk operations

### Phase 7: Offline & Download Support (Day 7)
1. Add continuous mode sync to `smartlists.js`
2. Implement downloaded comic updates
3. Test offline mode functionality
4. Test download/delete flow with continuous mode

### Phase 8: Polish & Testing (Day 8)
1. Fix any discovered bugs
2. Optimize performance (lazy loading, memory usage)
3. Cross-browser testing (Chrome, Firefox, Safari, Edge)
4. Mobile testing (iOS Safari, Chrome Mobile)
5. Add any missing error handling
6. Final integration testing

## Performance Considerations

### IntersectionObserver Configuration
- **rootMargin**: 500px ensures pages load before entering viewport
- **threshold**: 0 triggers as soon as any part is visible
- **Performance**: Much more efficient than scroll event listeners

### Memory Management
- Only loaded pages are kept in `pageElements` Map
- Browser handles image garbage collection
- No manual memory cleanup needed for images

### Scroll Performance
- **Debouncing**: 200ms debounce on scroll events prevents excessive updates
- **requestAnimationFrame**: Used for UI updates to avoid layout thrashing
- **Passive listeners**: Could be added for better scroll performance

### Image Loading
- **Native lazy loading**: `loading="lazy"` attribute on images
- **Progressive rendering**: Pages appear as they load, not all at once
- **Error handling**: Failed images show error message, don't break page

## Future Enhancements (Optional)

### Feature Ideas
1. **Horizontal continuous mode** - For wide-format comics
2. **Configurable page gaps** - User-adjustable spacing between pages
3. **Double-page spreads** - Show two pages side-by-side in continuous mode
4. **Smooth scroll to page** - Click page counter to scroll to specific page
5. **Reading position restoration** - Remember scroll position when switching modes
6. **Zoom controls** - Pinch-to-zoom in continuous mode
7. **Auto-scroll** - Automatically scroll at configurable speed
8. **Page separators** - Optional visual separators between pages
9. **Reading direction markers** - Visual indicators for manga vs normal reading

### Technical Improvements
1. **Virtual scrolling** - For extremely large comics (1000+ pages)
2. **Prefetch optimization** - Smarter prefetching based on scroll velocity
3. **Service worker integration** - Better offline support
4. **Accessibility** - Keyboard navigation in continuous mode
5. **Analytics** - Track continuous mode usage statistics

## Code Organization

### File Structure
```
comics-now/
├── docs/
│   └── continuous-mode-plan.md (this file)
├── public/
│   ├── index.html (UI elements)
│   ├── styles.css (continuous mode styling)
│   └── js/
│       ├── continuous.js (NEW - main module)
│       ├── viewer/
│       │   └── navigation.js (integration)
│       ├── library/
│       │   └── smartlists.js (download sync)
│       ├── settings.js (settings page)
│       ├── context-menu/
│       │   └── menu-builder.js (context menus)
│       └── globals.js (global exports)
└── server/
    ├── db.js (migrations)
    └── routes/
        └── api.js (API endpoints)
```

### Coding Standards
- Follow existing code style (ES6+, function declarations)
- Use async/await for asynchronous operations
- Add comprehensive error handling with try/catch
- Include console.log debugging with `[CONTINUOUS]` prefix
- Comment complex logic
- Use descriptive variable and function names

### Git Workflow
- Work on `vertical-scroll` branch
- Keep commits local until ready for review
- Commit after each phase completion
- Write descriptive commit messages
- Test before committing

## Summary

This plan provides a complete, production-ready implementation of vertical continuous scroll mode for the Comics Now application. The feature integrates seamlessly with existing functionality (manga mode, offline mode, multi-user support) and follows established patterns in the codebase.

**Estimated Total Time**: 8 days (1 day per phase)
**Complexity**: Medium-High
**Impact**: High (major new feature for user experience)
**Risk**: Low (isolated feature, no breaking changes to existing functionality)

---

**Branch**: `vertical-scroll`
**Status**: Planning Complete - Ready for Implementation
**Last Updated**: 2025-10-24
