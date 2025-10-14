module.exports = {
  testEnvironment: 'jsdom',
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/'
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 10000
};
