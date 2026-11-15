const { EventEmitter } = require('events');

jest.mock('child_process', () => ({
  fork: jest.fn()
}));

const { fork } = require('child_process');
const {
  detectPageInWorker,
  abortActiveWorker,
  resetWorkerState
} = require('../../../server/services/panel-detector/worker-client');

function createMockChild() {
  const child = new EventEmitter();
  child.connected = true;
  child.killed = false;
  child.kill = jest.fn((sig) => {
    child.killed = true;
    child.emit('exit', null, sig || 'SIGKILL');
  });
  child.send = jest.fn();
  return child;
}

describe('panel-detector ONNX worker client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetWorkerState();
  });

  test('serializes concurrent detectPageInWorker calls via localCpuMutex', async () => {
    const child = createMockChild();
    const order = [];
    child.send.mockImplementation((msg) => {
      order.push(`send:${msg.id}`);
      setTimeout(() => {
        order.push(`done:${msg.id}`);
        child.emit('message', {
          type: 'result',
          id: msg.id,
          rawPanels: [[1, 2, 3, 4]],
          panels: [[1, 2, 3, 4]],
          bubbles: [],
          sequence: [[1, 2, 3, 4]]
        });
      }, 15);
    });
    fork.mockReturnValue(child);

    const [r1, r2] = await Promise.all([
      detectPageInWorker(Buffer.from('a'), 'western'),
      detectPageInWorker(Buffer.from('b'), 'western')
    ]);

    expect(r1.panels).toEqual([[1, 2, 3, 4]]);
    expect(r2.panels).toEqual([[1, 2, 3, 4]]);
    // Second call must not send until first call completes
    expect(order[0]).toMatch(/^send:/);
    expect(order[1]).toMatch(/^done:/);
    expect(order[2]).toMatch(/^send:/);
    expect(order[3]).toMatch(/^done:/);
  });

  test('abortActiveWorker sends SIGKILL and rejects in-flight detection', async () => {
    const child = createMockChild();
    fork.mockReturnValue(child);

    const pending = detectPageInWorker(Buffer.from('hang'), 'western');
    await new Promise(r => setImmediate(r));
    abortActiveWorker();

    await expect(pending).rejects.toThrow(/Cancelled|killed/i);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
