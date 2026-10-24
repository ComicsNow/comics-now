const fs = require('fs');
const path = require('path');

async function benchmarkEventLoop() {
  const numIterations = 5000;
  const tempDir = path.join(__dirname, '..', 'tmp-bench-el');
  fs.mkdirSync(tempDir, { recursive: true });

  const sampleData = { pages: [1, 2, 3], other: "data".repeat(5000) };
  const sampleJson = JSON.stringify(sampleData);

  const items = Array.from({length: numIterations}, (_, i) => i);

  items.forEach(i => {
    fs.writeFileSync(path.join(tempDir, `sync_oldSidecar_${i}.json`), sampleJson, 'utf8');
  });

  console.log('--- SYNC BENCHMARK ---');
  let start = Date.now();

  for(let i=0; i<numIterations; i++) {
    const oldSidecar = path.join(tempDir, `sync_oldSidecar_${i}.json`);
    const sidecarPath = path.join(tempDir, `sync_sidecarPath_${i}.json`);
    const id = "new_id_" + i;

    try {
      const raw = fs.readFileSync(oldSidecar, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.pages) {
        parsed.comicId = id;
        fs.writeFileSync(sidecarPath, JSON.stringify(parsed, null, 2), 'utf8');
        if (oldSidecar !== sidecarPath && fs.existsSync(oldSidecar)) {
          try { fs.unlinkSync(oldSidecar); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  let end = Date.now();
  const syncTime = end - start;
  console.log(`Sync operations took ${syncTime} ms blocking the event loop`);

  // Setup files for async
  items.forEach(i => {
    fs.writeFileSync(path.join(tempDir, `async_oldSidecar_${i}.json`), sampleJson, 'utf8');
  });

  console.log('--- ASYNC BENCHMARK ---');
  start = Date.now();

  const asyncPromises = items.map(async (i) => {
    const oldSidecarAsync = path.join(tempDir, `async_oldSidecar_${i}.json`);
    const sidecarPathAsync = path.join(tempDir, `async_sidecarPath_${i}.json`);
    const id = "new_id_" + i;

    try {
      const raw = await fs.promises.readFile(oldSidecarAsync, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.pages) {
        parsed.comicId = id;
        await fs.promises.writeFile(sidecarPathAsync, JSON.stringify(parsed, null, 2), 'utf8');
        if (oldSidecarAsync !== sidecarPathAsync) {
           let exists = true;
           try { await fs.promises.access(oldSidecarAsync); } catch(_) { exists = false; }
           if (exists) {
             try { await fs.promises.unlink(oldSidecarAsync); } catch (_) {}
           }
        }
      }
    } catch (_) {}
  });

  await Promise.all(asyncPromises);

  end = Date.now();
  const asyncTime = end - start;
  console.log(`Async operations took ${asyncTime} ms non-blocking`);

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
}

benchmarkEventLoop().catch(console.error);
