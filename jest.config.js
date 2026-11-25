/**
 * Three projects, see docs/engineering/testing.md section 6.
 * - unit:        test/unit/, mirroring src/; no database, runs in parallel
 * - integration: repositories against real PostgreSQL (Testcontainers)
 * - api:         HTTP flows through the full app with supertest
 * Integration and API tests share one container started by test/setup.ts and run with --runInBand.
 *
 * ts-jest transpiles each file on its own because tsconfig.json sets isolatedModules.
 * Type errors are caught by `npm run typecheck`, not by the test run.
 */

/** @type {Record<string, unknown>} */
const shared = {
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  moduleFileExtensions: ["ts", "js", "json"],
  // Same alias as tsconfig.json "paths": tests import production code as "@src/...".
  moduleNameMapper: { "^@src/(.*)$": "<rootDir>/src/$1" },
};

/** @type {Record<string, unknown>} */
const database = {
  globalSetup: "<rootDir>/test/setup.ts",
  globalTeardown: "<rootDir>/test/teardown.ts",
};

/** @type {import("jest").Config} */
module.exports = {
  projects: [
    { ...shared, displayName: "unit", testMatch: ["<rootDir>/test/unit/**/*.test.ts"] },
    { ...shared, ...database, displayName: "integration", testMatch: ["<rootDir>/test/integration/**/*.int.test.ts"] },
    { ...shared, ...database, displayName: "api", testMatch: ["<rootDir>/test/api/**/*.api.test.ts"] },
  ],
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts"],
  coverageReporters: ["text-summary", "lcov"],
  coverageThreshold: {
    // testing.md section 7: domain and application only. infrastructure and interface are covered by
    // integration and API tests and have no threshold.
    "./src/**/{domain,application}/**/*.ts": { lines: 90, branches: 90 },
  },
};
