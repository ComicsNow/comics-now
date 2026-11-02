const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModuleInVm(relPath, sandbox) {
  const fullPath = path.resolve(__dirname, '../../..', relPath);
  const content = fs.readFileSync(fullPath, 'utf8');

  const cleanContent = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+class\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = class $1')
    .replace(/export\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = function $1')
    .replace(/export\s+async\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = async function $1')
    .replace(/export\s+const\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+let\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');

  const script = new vm.Script(cleanContent);
  script.runInContext(sandbox);
}

describe('Store Architecture (Phase 1)', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = {
      console: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      Date,
      Error,
      Map,
      Set,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Math,
      Reflect,
      Proxy
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
  });

  describe('EventBus', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/store/bus.js', sandbox);
    });

    it('registers listeners and dispatches events', () => {
      const bus = new sandbox.EventBus();
      const handler = jest.fn();

      const unsubscribe = bus.on('test:event', handler);
      bus.emit('test:event', { payload: 42 });

      expect(handler).toHaveBeenCalledWith({ payload: 42 });

      unsubscribe();
      bus.emit('test:event', { payload: 99 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('safely handles throwing listeners without interrupting others', () => {
      const bus = new sandbox.EventBus();
      const faultyHandler = jest.fn(() => { throw new Error('Boom'); });
      const goodHandler = jest.fn();

      bus.on('error:test', faultyHandler);
      bus.on('error:test', goodHandler);

      expect(() => bus.emit('error:test', 'data')).not.toThrow();
      expect(faultyHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalledWith('data');
      expect(sandbox.console.error).toHaveBeenCalled();
    });
  });

  describe('MutationAuditTrail', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/store/audit-trail.js', sandbox);
    });

    it('records mutations and maintains a ring buffer limit', () => {
      const audit = new sandbox.MutationAuditTrail(3);

      audit.record('page', 0, 1, 'nav');
      audit.record('page', 1, 2, 'nav');
      audit.record('comic', null, { id: 'c1' }, 'viewer');
      audit.record('page', 2, 3, 'nav'); // Should push out first entry

      const entries = audit.getEntries();
      expect(entries.length).toBe(3);
      expect(entries[0].oldValue).toBe(1);
      expect(entries[2].newValue).toBe(3);
      expect(entries[0].trace).toBeDefined();
    });

    it('filters entries by key and key prefix', () => {
      const audit = new sandbox.MutationAuditTrail(10);
      audit.record('viewer.page', 0, 1);
      audit.record('viewer.zoom', 1, 2);
      audit.record('nav.view', 'root', 'series');

      expect(audit.getEntries('viewer').length).toBe(2);
      expect(audit.getEntries('nav.view').length).toBe(1);
      expect(audit.getEntries('missing').length).toBe(0);
    });
  });

  describe('ComicsStore', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/store/bus.js', sandbox);
      loadModuleInVm('public/js/store/audit-trail.js', sandbox);
      loadModuleInVm('public/js/store/store.js', sandbox);
    });

    it('initializes with state and provides get/set reactivity', () => {
      const store = new sandbox.ComicsStore({ currentPageIndex: 0, isContinuousMode: false });

      expect(store.get('currentPageIndex')).toBe(0);
      expect(store.get('isContinuousMode')).toBe(false);

      const pageSubscriber = jest.fn();
      const unsub = store.subscribe('currentPageIndex', pageSubscriber);

      store.set('currentPageIndex', 1, 'user_jump');

      expect(store.get('currentPageIndex')).toBe(1);
      expect(pageSubscriber).toHaveBeenCalledWith(1, 0);

      // Verify audit trail logged it
      const auditEntries = store.audit.getEntries('currentPageIndex');
      expect(auditEntries.length).toBe(1);
      expect(auditEntries[0].source).toBe('user_jump');

      unsub();
      store.set('currentPageIndex', 2);
      expect(pageSubscriber).toHaveBeenCalledTimes(1);
    });

    it('does not trigger notifications if value is identical primitive', () => {
      const store = new sandbox.ComicsStore({ activeFilter: 'all' });
      const subscriber = jest.fn();
      store.subscribe('activeFilter', subscriber);

      store.set('activeFilter', 'all');
      expect(subscriber).not.toHaveBeenCalled();
      expect(store.audit.getEntries().length).toBe(0);
    });
  });

  describe('createStateProxy', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/store/bus.js', sandbox);
      loadModuleInVm('public/js/store/audit-trail.js', sandbox);
      loadModuleInVm('public/js/store/store.js', sandbox);
      loadModuleInVm('public/js/store/proxy.js', sandbox);
    });

    it('transparently delegates reads and writes to the store', () => {
      const store = new sandbox.ComicsStore({ currentPageIndex: 0, currentView: 'root' });
      const proxy = sandbox.createStateProxy(store, { warnOnDirectMutation: true });

      expect(proxy.currentPageIndex).toBe(0);
      expect(proxy.currentView).toBe('root');

      // Writing to proxy
      proxy.currentPageIndex = 4;
      expect(store.get('currentPageIndex')).toBe(4);
      expect(proxy.currentPageIndex).toBe(4);

      // Warn was called because warnOnDirectMutation is enabled
      expect(sandbox.console.warn).toHaveBeenCalled();

      // Audit trail captured the mutation
      const entries = store.audit.getEntries('currentPageIndex');
      expect(entries.length).toBe(1);
      expect(entries[0].newValue).toBe(4);
    });

    it('supports dynamic callback assignment for legacy compatibility', () => {
      const store = new sandbox.ComicsStore({});
      const proxy = sandbox.createStateProxy(store);
      const mockRender = jest.fn();

      proxy.renderPage = mockRender;
      expect(typeof proxy.renderPage).toBe('function');

      proxy.renderPage(5);
      expect(mockRender).toHaveBeenCalledWith(5);
    });

    it('supports property enumeration and "in" operator', () => {
      const store = new sandbox.ComicsStore({ a: 1, b: 2 });
      const proxy = sandbox.createStateProxy(store);

      expect('a' in proxy).toBe(true);
      expect('c' in proxy).toBe(false);

      proxy.c = 3;
      expect('c' in proxy).toBe(true);
      expect(Object.keys(proxy)).toContain('a');
      expect(Object.keys(proxy)).toContain('b');
      expect(Object.keys(proxy)).toContain('c');
    });
  });

  describe('Viewer Actions (Phase 3)', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/store/bus.js', sandbox);
      loadModuleInVm('public/js/store/audit-trail.js', sandbox);
      loadModuleInVm('public/js/store/store.js', sandbox);
      loadModuleInVm('public/js/store/actions/viewer.js', sandbox);
    });

    it('sets page index with boundary safety and emits pageChanged event', () => {
      const store = new sandbox.ComicsStore({
        currentPageIndex: 0,
        currentComic: { id: 'c1', progress: { totalPages: 10 } },
        einkMode: 'monochrome'
      });
      const actions = sandbox.createViewerActions(store);
      const listener = jest.fn();
      const flashListener = jest.fn();

      store.bus.on('viewer:pageChanged', listener);
      store.bus.on('eink:flash', flashListener);

      actions.setPageIndex(5, { source: 'jump', triggerFlash: true });

      expect(store.get('currentPageIndex')).toBe(5);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 5 }));
      expect(flashListener).toHaveBeenCalled();

      // Boundary clamp test: negative index
      actions.setPageIndex(-5);
      expect(store.get('currentPageIndex')).toBe(0);

      // Boundary clamp test: past totalPages
      actions.setPageIndex(25);
      expect(store.get('currentPageIndex')).toBe(9);
    });

    it('sets current comic and emits comicLoaded event', () => {
      const store = new sandbox.ComicsStore({});
      const actions = sandbox.createViewerActions(store);
      const listener = jest.fn();

      store.bus.on('viewer:comicLoaded', listener);

      const comic = { id: 'comic-456', title: 'X-Men' };
      actions.setCurrentComic(comic, { initialPage: 2 });

      expect(store.get('currentComic')).toEqual(comic);
      expect(store.get('currentPageIndex')).toBe(2);
      expect(listener).toHaveBeenCalledWith({ comic, initialPage: 2 });
    });

    it('toggles continuous mode and emits event', () => {
      const store = new sandbox.ComicsStore({ isContinuousMode: false });
      const actions = sandbox.createViewerActions(store);
      const listener = jest.fn();

      store.bus.on('viewer:continuousToggled', listener);

      actions.setContinuousMode(true);
      expect(store.get('isContinuousMode')).toBe(true);
      expect(listener).toHaveBeenCalledWith({ enabled: true });
    });

    it('closes viewer, restores returnContext, and emits viewer:closed', () => {
      const store = new sandbox.ComicsStore({
        currentComic: { id: 'c1' },
        currentView: 'viewer',
        viewerReturnContext: { view: 'series' }
      });
      const actions = sandbox.createViewerActions(store);
      const listener = jest.fn();

      store.bus.on('viewer:closed', listener);

      actions.closeViewer();
      expect(store.get('currentComic')).toBeNull();
      expect(store.get('currentView')).toBe('series');
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Navigation Actions (Phase 4)', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/store/bus.js', sandbox);
      loadModuleInVm('public/js/store/audit-trail.js', sandbox);
      loadModuleInVm('public/js/store/store.js', sandbox);
      loadModuleInVm('public/js/store/actions/navigation.js', sandbox);
    });

    it('sets view with context and emits navigation:viewChanged event', () => {
      const store = new sandbox.ComicsStore({ currentView: 'root' });
      const actions = sandbox.createNavigationActions(store);
      const listener = jest.fn();

      store.bus.on('navigation:viewChanged', listener);

      actions.setView('series', {
        publisher: 'Marvel',
        series: 'Spider-Man',
        folder: '/comics'
      });

      expect(store.get('currentView')).toBe('series');
      expect(store.get('currentPublisher')).toBe('Marvel');
      expect(store.get('currentSeries')).toBe('Spider-Man');
      expect(store.get('currentRootFolder')).toBe('/comics');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ view: 'series' }));
    });

    it('sets filters and emits filter:changed event', () => {
      const store = new sandbox.ComicsStore({
        activeFilter: 'all',
        activeAlphaFilter: 'All',
        activeSmartFilter: null
      });
      const actions = sandbox.createNavigationActions(store);
      const listener = jest.fn();

      store.bus.on('filter:changed', listener);

      actions.setFilter('status', 'unread');
      expect(store.get('activeFilter')).toBe('unread');
      expect(listener).toHaveBeenCalledWith({ filterType: 'status', value: 'unread' });

      actions.setFilter('alpha', 'B');
      expect(store.get('activeAlphaFilter')).toBe('B');

      actions.setFilter('smart', 'reading');
      expect(store.get('activeSmartFilter')).toBe('reading');
    });

    it('sets series sort order and emits navigation:sortChanged event', () => {
      const store = new sandbox.ComicsStore({ seriesSortOrder: 'name' });
      const actions = sandbox.createNavigationActions(store);
      const listener = jest.fn();

      store.bus.on('navigation:sortChanged', listener);

      actions.setSeriesSortOrder('date_desc');
      expect(store.get('seriesSortOrder')).toBe('date_desc');
      expect(listener).toHaveBeenCalledWith({ order: 'date_desc' });
    });
  });

  describe('Strict Mode & DOM Isolation (Phase 5)', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/store/bus.js', sandbox);
      loadModuleInVm('public/js/store/audit-trail.js', sandbox);
      loadModuleInVm('public/js/store/store.js', sandbox);
      loadModuleInVm('public/js/store/proxy.js', sandbox);
    });

    it('identifies migrated properties and logs detailed warning on direct mutation', () => {
      const store = new sandbox.ComicsStore({ currentPageIndex: 0 });
      const proxy = sandbox.createStateProxy(store, { warnOnDirectMutation: true });

      proxy.currentPageIndex = 3;
      expect(sandbox.console.warn).toHaveBeenCalledWith(
        expect.stringContaining('(migrated to store.actions)')
      );
    });

    it('loads dom.js and safely retrieves elements or null without throwing', () => {
      sandbox.document = {
        getElementById: jest.fn(id => ({ id, nodeType: 1 })),
        querySelector: jest.fn(() => null)
      };
      loadModuleInVm('public/js/dom.js', sandbox);

      expect(sandbox.getElement).toBeDefined();
      const el = sandbox.getElement('comic-viewer');
      expect(el).toEqual(expect.objectContaining({ id: 'comic-viewer' }));
      // Caching check
      const el2 = sandbox.getElement('comic-viewer');
      expect(el2).toBe(el);
    });
  });
});
