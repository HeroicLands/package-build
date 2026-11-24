// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const BIN = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "bin",
    "package-build.mjs",
);

/** The `--help` text of one command. */
function help(...args: string[]): string {
    const r = spawnSync(process.execPath, [BIN, ...args, "--help"], {
        cwd: os.tmpdir(),
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(os.tmpdir(), "missing.yaml") },
        encoding: "utf8",
    });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

describe("the help of the stage commands names what they read", () => {
    it(
        "e2e lists fast's flags, the sweep build and its variables",
        () => {
            const out = help("e2e");
            for (const word of [
                "sweep <version>",
                "--build=",
                "--recreate",
                "--no-run",
                "--spec",
                "FOUNDRYVTT_<STAGE>_DATA",
                "<PREFIX>_E2E_WORLD_ID",
                "HL_BROWSER_CACHE",
            ]) {
                expect(out).toContain(word);
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "deploy names its stages and variables",
        () => {
            const out = help("deploy");
            for (const word of [
                "dev, qa, prod or test",
                "FOUNDRYVTT_<STAGE>_DATA",
                "<PREFIX>_SFTP_PORT",
            ]) {
                expect(out).toContain(word);
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "container names its variables",
        () => {
            const out = help("container");
            for (const word of [
                "FOUNDRYVTT_<STAGE>_PORT",
                "FOUNDRYVTT_<STAGE>_WORLD",
                "FOUNDRYVTT_CONTAINER_IMAGE",
            ]) {
                expect(out).toContain(word);
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
