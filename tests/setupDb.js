// Automatically ensure schema is initialized for all test suites
beforeAll(async () => {
  try {
    const { initializeDatabase } = require('../server/db');
    await initializeDatabase();
  } catch (err) {
    // Gracefully handle in case db is not required
  }
});
