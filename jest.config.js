module.exports = {
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/'
  ],
  setupFiles: [
    '<rootDir>/tests/setupEnv.js'
  ],
  setupFilesAfterEnv: [
    '<rootDir>/tests/setupDb.js'
  ]
};
