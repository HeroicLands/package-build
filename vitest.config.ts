import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The package's own test harness.
 *
 * Deliberately austere. There is no `tests/setup.ts` and no `@src` alias: the
 * pipeline is Foundry-free and severed from the system source, and a harness
 * that offered either would let that severance rot. A test that needs the
 * *system* is not a test of this package.
 *
 * **The suite is configured from a fixture repository, not from the root.** The
 * Foundry package id and the system version are derived from the `package.json`
 * beside the configuration, and at the root that is this toolchain's own
 * manifest — `@heroiclands/package-build`, which is neither a Foundry package
 * id nor a game system version. `tests/fixtures/repo/` holds a configuration
 * with a `package.json` shaped like a consumer's, which is what makes the
 * derivation mean anything.
 *
 * The variable is set for the whole suite rather than for the content half
 * alone, because both halves now live in one `tests/` directory and splitting
 * them by project would mean sorting 66 files by which package they came from.
 * The packaging tests resolve their configuration from data they construct, so
 * a variable naming a fixture on disk is inert to them.
 * `tests/import-needs-no-config.test.ts` deletes it from the environment it
 * spawns into, so the case proving the package imports with *no* configuration
 * is unaffected.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        name: "package-build",
        globals: true,
        environment: "node",
        include: ["tests/**/*.test.ts"],
        env: {
            PACKAGE_BUILD_CONFIG: path.join(HERE, "tests/fixtures/repo/package-build.config.yaml"),
        },
    },
});
