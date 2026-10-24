const { checkComicAccess } = require('./server/access-control');

async function runBenchmark(usePromiseAll) {
  // Mock data
  const rows = [];
  for (let i = 0; i < 5000; i++) {
    rows.push({
      id: i,
      path: `/library/comic${i}.cbz`,
      publisher: 'Publisher ' + (i % 10),
      series: 'Series ' + (i % 100),
      name: 'Comic ' + i,
      thumbnailPath: '/thumb.jpg',
      lastReadPage: 0,
      totalPages: 10,
      metadata: '{}'
    });
  }

  const userId = 'user1';
  const userRole = 'user';
  const directories = ['/library'];
  const accessList = [{ accessType: 'publisher', accessValue: 'Publisher 1', child_access: 1 }];

  const start = performance.now();

  if (!usePromiseAll) {
    const results = [];
    for (const r of rows) {
      const hasAccess = await checkComicAccess(
        userId,
        userRole,
        r.path,
        r.publisher,
        r.series,
        directories,
        r.id,
        accessList
      );
      if (hasAccess) {
        results.push(r);
      }
    }
    // console.log(`Got ${results.length} results sequentially`);
  } else {
    // Optimization technique 1: Promise.all map
    const checks = rows.map(async (r) => {
      const hasAccess = await checkComicAccess(
        userId,
        userRole,
        r.path,
        r.publisher,
        r.series,
        directories,
        r.id,
        accessList
      );
      return hasAccess ? r : null;
    });
    const results = (await Promise.all(checks)).filter(r => r !== null);
    // console.log(`Got ${results.length} results concurrently`);
  }

  const end = performance.now();
  console.log(`${usePromiseAll ? 'Promise.all' : 'Sequential'} took ${end - start} ms`);
}

async function runAll() {
  console.log("Warmup...");
  await runBenchmark(false);
  await runBenchmark(true);

  console.log("Run...");
  await runBenchmark(false);
  await runBenchmark(true);
}

runAll();
