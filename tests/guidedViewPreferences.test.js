/**
 * Unit tests for Guided View preference persistence and memory
 */

describe('Guided View Preference Persistence', () => {
  let localStorageMock;
  let ModeRegistry;
  let mockComic;

  beforeEach(() => {
    // Setup mock localStorage
    const store = {};
    localStorageMock = {
      getItem: jest.fn(key => (key in store ? store[key] : null)),
      setItem: jest.fn((key, value) => {
        store[key] = String(value);
      }),
      removeItem: jest.fn(key => {
        delete store[key];
      }),
      clear: jest.fn(() => {
        for (const k in store) delete store[k];
      })
    };
    global.localStorage = localStorageMock;

    mockComic = {
      id: 'comic-123',
      name: 'Spider-Man #1',
      guidedViewStatus: 'completed',
      mangaMode: false,
      guidedMode: false,
      bubbleMode: false,
      hotZoomMode: false,
      mangaBubbleHotMode: false
    };

    // Construct fresh ModeRegistry logic for isolated testing
    const modes = new Map();
    let activeModeName = null;
    let transitioning = false;

    const registry = {
      register(name, mode) {
        modes.set(name, mode);
      },
      get(name) {
        return modes.get(name);
      },
      getActiveModeName() {
        return activeModeName;
      },
      async enable(name, { persist = true } = {}) {
        if (transitioning) return false;
        const mode = modes.get(name);
        if (!mode) return false;
        if (activeModeName === name) return true;

        transitioning = true;
        try {
          if (activeModeName) {
            this.disable(activeModeName, { persist: false });
          }
          activeModeName = name;
          if (persist) {
            this.persistOnlyMode(mockComic, name);
          }
          const success = await mode.enable();
          if (!success) activeModeName = null;
          return success;
        } finally {
          transitioning = false;
        }
      },
      disable(name, { persist = true } = {}) {
        const mode = modes.get(name);
        if (mode) {
          if (activeModeName === name) {
            activeModeName = null;
            if (persist) {
              this.persistOnlyMode(mockComic, null);
            }
          }
          mode.disable();
        }
        manualOverrideBox = null;
      },
      disableAll({ persist = false } = {}) {
        if (activeModeName) {
          const mode = modes.get(activeModeName);
          if (mode) mode.disable();
          activeModeName = null;
        }
        if (persist) {
          this.persistOnlyMode(mockComic, null);
        }
        manualOverrideBox = null;
      },
      toggle(name) {
        if (activeModeName === name) {
          this.disable(name, { persist: true });
          return false;
        }
        return this.enable(name, { persist: true });
      },
      persistOnlyMode(comic, kept) {
        if (!comic) return;
        const modeMapping = {
          'guided': 'guidedMode',
          'bubble': 'bubbleMode',
          'western-speech-zoom': 'hotZoomMode',
          'manga-panel-zoom': 'hotZoomMode',
          'manga-speech-zoom': 'mangaBubbleHotMode'
        };
        const keptPrefKey = (kept && modeMapping[kept]) ? modeMapping[kept] : null;
        if (kept && modeMapping[kept]) {
          const prefKey = modeMapping[kept];
          comic[prefKey] = true;
          this.saveModePreference(comic.id, kept, true);
        } else if (kept === null || kept === 'none') {
          this.saveModePreference(comic.id, null, false);
        }
        const allPrefKeys = new Set(Object.values(modeMapping));
        allPrefKeys.forEach(prefKey => {
          if (prefKey !== keptPrefKey && comic[prefKey]) {
            comic[prefKey] = false;
          }
        });
      },
      saveModePreference(comicId, modeName, value) {
        try {
          if (value && modeName) {
            localStorage.setItem(`guided_pref_${comicId}`, modeName);
            localStorage.setItem('guided_pref_last_mode', modeName);
            localStorage.setItem('guided_pref_global_active', 'true');
          } else {
            localStorage.setItem(`guided_pref_${comicId}`, 'none');
            localStorage.setItem('guided_pref_global_active', 'false');
          }
        } catch (e) {}
      }
    };

    const mockBubbleMode = {
      enable: jest.fn(async () => true),
      disable: jest.fn()
    };
    const mockGuidedMode = {
      enable: jest.fn(async () => true),
      disable: jest.fn()
    };
    const mockWesternSpeechZoomMode = {
      enable: jest.fn(async () => true),
      disable: jest.fn()
    };
    const mockMangaPanelZoomMode = {
      enable: jest.fn(async () => true),
      disable: jest.fn()
    };
    const mockMangaSpeechZoomMode = {
      enable: jest.fn(async () => true),
      disable: jest.fn()
    };

    registry.register('bubble', mockBubbleMode);
    registry.register('guided', mockGuidedMode);
    registry.register('western-speech-zoom', mockWesternSpeechZoomMode);
    registry.register('manga-panel-zoom', mockMangaPanelZoomMode);
    registry.register('manga-speech-zoom', mockMangaSpeechZoomMode);

    ModeRegistry = registry;
  });

  it('should persist preference in localStorage and comic object on enable bubble', async () => {
    await ModeRegistry.enable('bubble');
    expect(ModeRegistry.getActiveModeName()).toBe('bubble');
    expect(mockComic.bubbleMode).toBe(true);
    expect(mockComic.hotZoomMode).toBe(false);
    expect(localStorageMock.getItem('guided_pref_comic-123')).toBe('bubble');
    expect(localStorageMock.getItem('guided_pref_last_mode')).toBe('bubble');
    expect(localStorageMock.getItem('guided_pref_global_active')).toBe('true');
  });

  it('should persist western-speech-zoom and NOT clear hotZoomMode due to key loop collision', async () => {
    await ModeRegistry.enable('western-speech-zoom');
    expect(ModeRegistry.getActiveModeName()).toBe('western-speech-zoom');
    expect(mockComic.hotZoomMode).toBe(true);
    expect(mockComic.bubbleMode).toBe(false);
    expect(localStorageMock.getItem('guided_pref_comic-123')).toBe('western-speech-zoom');
    expect(localStorageMock.getItem('guided_pref_last_mode')).toBe('western-speech-zoom');
    expect(localStorageMock.getItem('guided_pref_global_active')).toBe('true');
  });

  it('should persist manga-speech-zoom correctly', async () => {
    await ModeRegistry.enable('manga-speech-zoom');
    expect(ModeRegistry.getActiveModeName()).toBe('manga-speech-zoom');
    expect(mockComic.mangaBubbleHotMode).toBe(true);
    expect(mockComic.hotZoomMode).toBe(false);
    expect(localStorageMock.getItem('guided_pref_comic-123')).toBe('manga-speech-zoom');
    expect(localStorageMock.getItem('guided_pref_last_mode')).toBe('manga-speech-zoom');
    expect(localStorageMock.getItem('guided_pref_global_active')).toBe('true');
  });

  it('should clear old mode flag when switching between modes', async () => {
    await ModeRegistry.enable('western-speech-zoom');
    expect(mockComic.hotZoomMode).toBe(true);

    await ModeRegistry.enable('bubble');
    expect(mockComic.bubbleMode).toBe(true);
    expect(mockComic.hotZoomMode).toBe(false);
    expect(localStorageMock.getItem('guided_pref_comic-123')).toBe('bubble');
  });

  it('should NOT wipe preference when disableAll is called without persist (e.g. viewer closed)', async () => {
    await ModeRegistry.enable('western-speech-zoom');
    expect(localStorageMock.getItem('guided_pref_comic-123')).toBe('western-speech-zoom');

    // Simulate closing the fullscreen viewer
    ModeRegistry.disableAll({ persist: false });

    // Active mode in memory should be cleared
    expect(ModeRegistry.getActiveModeName()).toBeNull();
    // But saved preference should still be 'western-speech-zoom'
    expect(localStorageMock.getItem('guided_pref_comic-123')).toBe('western-speech-zoom');
    expect(localStorageMock.getItem('guided_pref_global_active')).toBe('true');
    expect(mockComic.hotZoomMode).toBe(true);
  });

  it('should mark preference as none when user explicitly disables the mode', async () => {
    await ModeRegistry.enable('western-speech-zoom');
    expect(localStorageMock.getItem('guided_pref_comic-123')).toBe('western-speech-zoom');

    // User toggles it off
    ModeRegistry.disable('western-speech-zoom', { persist: true });

    expect(ModeRegistry.getActiveModeName()).toBeNull();
    expect(mockComic.hotZoomMode).toBe(false);
    expect(localStorageMock.getItem('guided_pref_comic-123')).toBe('none');
    expect(localStorageMock.getItem('guided_pref_global_active')).toBe('false');
  });

  it('should resolve preferred mode properly for comics across manga and western formats', () => {
    function resolveMode(comic) {
      const isManga = !!(comic && (comic.mangaMode === true || comic.mangaMode == 1));
      let preferredMode = null;
      const localPref = localStorage.getItem(`guided_pref_${comic.id}`);
      if (localPref === 'none') {
        preferredMode = null;
      } else if (localPref) {
        preferredMode = localPref;
      } else {
        if (comic.guidedMode) preferredMode = 'guided';
        else if (comic.bubbleMode) preferredMode = 'bubble';
        else if (comic.hotZoomMode) preferredMode = isManga ? 'manga-panel-zoom' : 'western-speech-zoom';
        else if (comic.mangaBubbleHotMode) preferredMode = 'manga-speech-zoom';
        else if (localStorage.getItem('guided_pref_global_active') === 'true') {
          const lastMode = localStorage.getItem('guided_pref_last_mode');
          if (isManga) {
            if (lastMode === 'guided' || lastMode === 'manga-panel-zoom' || lastMode === 'manga-speech-zoom') {
              preferredMode = lastMode;
            } else if (lastMode === 'western-speech-zoom') {
              preferredMode = 'manga-speech-zoom';
            } else {
              preferredMode = 'guided';
            }
          } else {
            if (lastMode === 'bubble' || lastMode === 'western-speech-zoom') {
              preferredMode = lastMode;
            } else if (lastMode === 'manga-speech-zoom') {
              preferredMode = 'western-speech-zoom';
            } else {
              preferredMode = 'bubble';
            }
          }
        }
      }

      // Normalize preferredMode to match comic mangaMode
      if (preferredMode) {
        if (isManga) {
          if (preferredMode === 'bubble') preferredMode = 'guided';
          else if (preferredMode === 'western-speech-zoom') preferredMode = 'manga-speech-zoom';
        } else {
          if (preferredMode === 'guided' || preferredMode === 'manga-panel-zoom') preferredMode = 'bubble';
          else if (preferredMode === 'manga-speech-zoom') preferredMode = 'western-speech-zoom';
        }
      }

      return preferredMode;
    }

    // 1. Explicit comic preference
    localStorageMock.setItem('guided_pref_comic-123', 'western-speech-zoom');
    expect(resolveMode(mockComic)).toBe('western-speech-zoom');

    // 2. Explicitly disabled comic preference ('none')
    localStorageMock.setItem('guided_pref_comic-123', 'none');
    localStorageMock.setItem('guided_pref_global_active', 'true');
    expect(resolveMode(mockComic)).toBeNull();

    // 3. New comic inherits global speech zoom across types
    localStorageMock.removeItem('guided_pref_comic-456');
    localStorageMock.removeItem('guided_pref_comic-789');
    localStorageMock.setItem('guided_pref_global_active', 'true');
    localStorageMock.setItem('guided_pref_last_mode', 'western-speech-zoom');

    const newWesternComic = { id: 'comic-456', mangaMode: false };
    expect(resolveMode(newWesternComic)).toBe('western-speech-zoom');

    // Speech zoom maps to manga-speech-zoom on Manga
    const newMangaComic = { id: 'comic-789', mangaMode: true };
    expect(resolveMode(newMangaComic)).toBe('manga-speech-zoom');

    // Manga speech zoom maps to western-speech-zoom on Western
    localStorageMock.setItem('guided_pref_last_mode', 'manga-speech-zoom');
    expect(resolveMode(newWesternComic)).toBe('western-speech-zoom');

    // Bubble maps to guided on Manga
    localStorageMock.setItem('guided_pref_last_mode', 'bubble');
    expect(resolveMode(newMangaComic)).toBe('guided');
  });
});
