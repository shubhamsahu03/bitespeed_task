import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src/__tests__"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  // Increase global timeout — tests hit a cloud DB (Neon) with ~1-2s latency per request.
  // Scenarios 4/5/6 make 3-5 requests each, so 5000ms default is too tight.
  testTimeout: 30000,
  forceExit: true,
  clearMocks: true,
  // New ts-jest transform syntax (globals is deprecated since ts-jest v29)
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          strict: false,
        },
      },
    ],
  },
};

export default config;