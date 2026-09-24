const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

// Ensure all tests run against an isolated test data directory per Jest worker, never production data
const workerId = process.env.JEST_WORKER_ID || '1';
const testDataDir = path.resolve(__dirname, '..', '.test-data', `worker-${workerId}`);
if (!fs.existsSync(testDataDir)) {
  fs.mkdirSync(testDataDir, { recursive: true });
}
process.env.DATA_DIR = testDataDir;
