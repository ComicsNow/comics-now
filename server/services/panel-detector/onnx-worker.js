const { detectPageInProcess } = require('./worker-client');

process.on('message', async (msg) => {
  if (!msg || msg.type !== 'detect-page') return;
  try {
    const buffer = Buffer.from(msg.bufferBase64, 'base64');
    const result = await detectPageInProcess(buffer, msg.comicType || 'western');
    if (typeof process.send === 'function') {
      process.send({
        type: 'result',
        id: msg.id,
        rawPanels: result.rawPanels,
        panels: result.panels,
        bubbles: result.bubbles,
        sequence: result.sequence
      });
    }
  } catch (err) {
    if (typeof process.send === 'function') {
      process.send({
        type: 'error',
        id: msg.id,
        message: err && err.message ? err.message : String(err)
      });
    }
  }
});
