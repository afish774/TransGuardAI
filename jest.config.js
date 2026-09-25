/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/backend/**/*.test.js'],
  testTimeout: 30000, // bcrypt + mongodb-memory-server can be slow
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  // Run tests sequentially so all files share one mongoose connection
  maxWorkers: 1,
  collectCoverageFrom: [
    'routes/**/*.js',
    'models/**/*.js',
    'services/**/*.js',
    'middleware/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
};
