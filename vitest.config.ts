import { defineConfig } from "vitest/config";

/**
 * The package's own test harness.
 *
 * Deliberately austere: no setup file, no aliases. Everything here is plain ESM
 * over Node built-ins and three dependencies, and a harness that offered a
 * Foundry global or a `@src` path would let something reach for one.
 *
 * A test that needs the *system* is not a test of this package.
 */
export default defineConfig({
    test: {
        name: "package-build",
        globals: true,
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
