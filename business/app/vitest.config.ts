import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    pool: "forks", // better-sqlite3 native bindings prefer process isolation
  },
});
