// Jest setup file for DOM testing
// Add custom matchers and global test utilities

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to suppress logs during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  error: jest.fn(), // Keep error suppressed for cleaner output
};
