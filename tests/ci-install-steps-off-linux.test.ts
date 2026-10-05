/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The Build & Test steps that install a tool do so only on Linux.
 *
 * `package-build ci --native` replays the workflow's `run:` steps on the host.
 * On a Mac, a step that downloads a Linux binary into `/usr/local/bin` or calls
 * `apt-get` fails, so each install step takes the tool from `PATH` off Linux
 * and refuses, naming the tool, when it is absent.
 *
 * The steps are read out of the workflow and run under a stub `PATH`: `uname`
 * answers `Darwin`, and `curl`, `tar`, `apt-get` and `sudo` record that they
 * were called. Which steps are install steps is derived from what they write,
 * so a new one is held to the same rule the day it is added.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stepsIn } from "../ci/ci-steps.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "build.yml");
const BASH = ["/bin/bash", "/usr/bin/bash"].find((p) => fs.existsSync(p)) ?? "bash";

/** The tool each install step provides, keyed by what its `--version` probe calls. */
const TOOLS = ["typst", "hugo", "dot"];

const installSteps = stepsIn(WORKFLOW).run.filter((step: { run: string }) =>
    /\/usr\/local\/bin|apt-get/.test(step.run),
);

let stubs: string;
let calls: string;

/** Write an executable stub. */
function stub(name: string, body: string): void {
    const file = path.join(stubs, name);
    fs.writeFileSync(file, `#!${BASH}\n${body}\n`);
    fs.chmodSync(file, 0o755);
}

/** Run one step's script under the stub `PATH`. */
function runStep(script: string) {
    return spawnSync(BASH, ["-e", "-o", "pipefail", "-c", script], {
        encoding: "utf8",
        env: { PATH: stubs, HOME: stubs },
    });
}

/** The commands a step tried to install with. */
function installAttempts(): string[] {
    return fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [];
}

beforeEach(() => {
    stubs = fs.mkdtempSync(path.join(os.tmpdir(), "ci-install-off-linux-"));
    calls = path.join(stubs, "calls.log");
    stub("uname", 'if [ "$1" = "-m" ]; then echo arm64; else echo Darwin; fi');
    for (const name of ["curl", "tar", "apt-get", "sudo"]) {
        stub(name, `echo ${name} >> "${calls}"; exit 99`);
    }
});

afterEach(() => {
    fs.rmSync(stubs, { recursive: true, force: true });
});

describe("Build & Test install steps off Linux", () => {
    it("are found at all, so the cases below are not vacuous", () => {
        expect(installSteps.length).toBeGreaterThanOrEqual(3);
    });

    it.each(installSteps.map((step: { name: string; run: string }) => [step.name, step.run]))(
        "%s uses the tool already on PATH",
        (_name, script) => {
            for (const tool of TOOLS) stub(tool, `echo "${tool} stub"`);
            const result = runStep(script as string);
            expect(result.status, result.stderr).toBe(0);
            expect(installAttempts()).toEqual([]);
        },
    );

    it.each(installSteps.map((step: { name: string; run: string }) => [step.name, step.run]))(
        "%s refuses, naming the tool, when it is absent",
        (_name, script) => {
            const result = runStep(script as string);
            expect(result.status).not.toBe(0);
            expect(installAttempts()).toEqual([]);
            expect(result.stderr).toMatch(/not on PATH/);
        },
    );
});
