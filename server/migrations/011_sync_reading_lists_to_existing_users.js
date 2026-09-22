const { syncDefaultReadingListsToAllUsers } = require('../services/readingLists');

module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    try {
      const res = await syncDefaultReadingListsToAllUsers({ dbRun, dbGet, dbAll, log: console.log });
      console.log(`[MIGRATION] Synced ${res.totalCreated} default reading lists across ${res.usersCount} users.`);
    } catch (err) {
      console.error(`[MIGRATION] Failed to sync reading lists in migration 011: ${err.message}`);
      throw err;
    }
  }
};
