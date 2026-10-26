const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Continuous Mode', () => {
  let sandbox;
  let vmContext;

  beforeEach(() => {
    // Setup a DOM environment for testing the JS code
    sandbox = {
      window: {
        addEventListener: jest.fn(),
        einkMode: 'none',
        innerWidth: 1024,
        innerHeight: 768,
      },
      document: {
        createElement: jest.fn((tag) => {
            const el = {
              tag,
              style: {},
              classList: {
                add: jest.fn(),
                remove: jest.fn(),
                contains: jest.fn(),
              },
              addEventListener: jest.fn(),
              dataset: {},
              querySelector: jest.fn(),
              querySelectorAll: jest.fn(() => []),
              getElementById: jest.fn(),
              appendChild: jest.fn(),
              innerHTML: '',
            };
            return el;
        }),
        getElementById: jest.fn((id) => {
            const el = {
                id,
                classList: {
                    add: jest.fn(),
                    remove: jest.fn(),
                    contains: jest.fn(),
                },
                style: {},
                addEventListener: jest.fn(),
                querySelector: jest.fn(),
                querySelectorAll: jest.fn(() => []),
                appendChild: jest.fn(),
                innerHTML: '',
            };
            return el;
        }),
        readyState: 'complete',
        addEventListener: jest.fn(),
        querySelector: jest.fn(),
      },
      console: {
        error: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      },
      state: {},
      setTimeout: setTimeout,
      IntersectionObserver: class {
        observe() {}
        disconnect() {}
      },
      localStorage: {
          setItem: jest.fn(),
          getItem: jest.fn(),
      },
      alert: jest.fn(),
      saveProgressToDB: jest.fn(),
      updateLibraryProgress: jest.fn(),
    };
    sandbox.global = sandbox;
    sandbox.window.document = sandbox.document;
    vmContext = vm.createContext(sandbox);

    const continuousPath = path.join(__dirname, '../../../public/js/continuous.js');
    const continuousCode = fs.readFileSync(continuousPath, 'utf-8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[^;]+;?/g, '');

    new vm.Script(continuousCode).runInContext(vmContext);

    // explicitly expose functions generated from the vm script to sandbox root
    sandbox.initializeContinuousMode = vmContext.initializeContinuousMode;
    sandbox.toggleContinuousMode = vmContext.toggleContinuousMode;
    sandbox.updateContinuousModeUI = vmContext.updateContinuousModeUI;
    sandbox.updateContinuousModeInCache = vmContext.updateContinuousModeInCache;
  });

  it('should initialize successfully', () => {
    expect(sandbox.initializeContinuousMode).toBeDefined();
  });

  it('should toggle continuous mode correctly', () => {
    expect(sandbox.toggleContinuousMode('comic1', true)).toBe(false);
    expect(sandbox.toggleContinuousMode('comic1', false)).toBe(true);
  });

  it('should update continuous mode UI correctly when active', () => {
      const btn1 = { classList: { add: jest.fn(), remove: jest.fn() } };
      const btn2 = { classList: { add: jest.fn(), remove: jest.fn() } };

      sandbox.document.getElementById.mockImplementation((id) => {
          if (id === 'continuous-mode-btn') return btn1;
          if (id === 'fullscreen-continuous-mode-btn') return btn2;
          return null;
      });

      sandbox.updateContinuousModeUI(true);

      expect(sandbox.document.getElementById).toHaveBeenCalledWith('continuous-mode-btn');
      expect(sandbox.document.getElementById).toHaveBeenCalledWith('fullscreen-continuous-mode-btn');

      expect(btn1.classList.add).toHaveBeenCalledWith('active');
      expect(btn1.classList.remove).not.toHaveBeenCalled();
      expect(btn2.classList.add).toHaveBeenCalledWith('active');
      expect(btn2.classList.remove).not.toHaveBeenCalled();
  });

  it('should update continuous mode UI correctly when inactive', () => {
      const btn1 = { classList: { add: jest.fn(), remove: jest.fn() } };
      const btn2 = { classList: { add: jest.fn(), remove: jest.fn() } };

      sandbox.document.getElementById.mockImplementation((id) => {
          if (id === 'continuous-mode-btn') return btn1;
          if (id === 'fullscreen-continuous-mode-btn') return btn2;
          return null;
      });

      sandbox.updateContinuousModeUI(false);

      expect(sandbox.document.getElementById).toHaveBeenCalledWith('continuous-mode-btn');
      expect(sandbox.document.getElementById).toHaveBeenCalledWith('fullscreen-continuous-mode-btn');

      expect(btn1.classList.remove).toHaveBeenCalledWith('active');
      expect(btn1.classList.add).not.toHaveBeenCalled();
      expect(btn2.classList.remove).toHaveBeenCalledWith('active');
      expect(btn2.classList.add).not.toHaveBeenCalled();
  });

  describe('updateContinuousModeInCache', () => {
    it('should update continuous mode in cache successfully', async () => {
      const mockCache = {
        data: {
          'root1': {
            publishers: {
              'pub1': {
                series: {
                  'series1': [
                    { id: 'comic1', continuousMode: false }
                  ]
                }
              }
            }
          }
        }
      };

      sandbox.state.loadLibraryCacheFromDB = jest.fn().mockResolvedValue(mockCache);
      sandbox.state.saveLibraryCacheToDB = jest.fn().mockResolvedValue(true);

      const result = await sandbox.updateContinuousModeInCache('comic1', true);

      expect(result).toBe(true);
      expect(mockCache.data['root1'].publishers['pub1'].series['series1'][0].continuousMode).toBe(true);
      expect(sandbox.state.saveLibraryCacheToDB).toHaveBeenCalledWith(mockCache.data);
    });

    it('should return false if loadLibraryCacheFromDB is missing', async () => {
      sandbox.state.loadLibraryCacheFromDB = undefined;
      sandbox.window.loadLibraryCacheFromDB = undefined;

      const result = await sandbox.updateContinuousModeInCache('comic1', true);
      expect(result).toBe(false);
    });

    it('should return false if comic is not found in cache', async () => {
      const mockCache = {
        data: {
          'root1': { publishers: {} }
        }
      };

      sandbox.state.loadLibraryCacheFromDB = jest.fn().mockResolvedValue(mockCache);

      const result = await sandbox.updateContinuousModeInCache('comic2', true);
      expect(result).toBe(false);
    });
  });
});
