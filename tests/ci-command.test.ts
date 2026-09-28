/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/package-build.mjs", import.meta.url));
let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "package-build-ci-command-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function workflow(steps: string) {
    const directory = path.join(root, ".github", "workflows");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
        path.join(directory, "build.yml"),
        `name: Build\non:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`,
    );
}

function run(args: string[], env = process.env, cwd = root) {
    const result = spawnSync(process.execPath, [BIN, "ci", ...args], {
        cwd,
        env,
        encoding: "utf8",
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("package-build ci", () => {
    it("runs workflow commands on the host and names published actions it skips", () => {
        workflow(
            `      - name: Local check\n        run: node -e "process.stdout.write('checked')"\n` +
                `      - name: Published check\n        uses: actions/checkout@v4\n`,
        );
        const result = run(["--native"]);
        expect(result.code).toBe(0);
        expect(result.output).toContain("checked");
        expect(result.output).toContain("Published check");
        expect(result.output).toContain(".github/workflows/build.yml");
    });

    it("finds the repository workflow when invoked from a subdirectory", () => {
        workflow(
            `      - name: Local check\n        run: node -e "process.stdout.write('checked')"\n`,
        );
        const init = spawnSync("git", ["init", "-q"], { cwd: root });
        expect(init.status).toBe(0);
        const subdirectory = path.join(root, "nested");
        fs.mkdirSync(subdirectory);
        const result = run(["--native"], process.env, subdirectory);
        expect(result.code).toBe(0);
        expect(result.output).toContain("checked");
    });

    it("stops at the first failed workflow command", () => {
        const marker = path.join(root, "later-ran");
        workflow(
            `      - name: Failing check\n        run: node -e "process.exit(7)"\n` +
                `      - name: Later check\n        run: node -e "require('fs').writeFileSync('${marker}', 'ran')"\n`,
        );
        const result = run(["--native"]);
        expect(result.code).toBe(1);
        expect(result.output).toContain('FAILED at "Failing check"');
        expect(fs.existsSync(marker)).toBe(false);
    });

    it("fails when no pull-request workflow has runnable commands", () => {
        const result = run(["--native"]);
        expect(result.code).toBe(1);
        expect(result.output).toContain("no workflow");
    });

    it("reports that the default replay needs Docker", () => {
        const directory = path.join(root, "bin");
        fs.mkdirSync(directory);
        const docker = path.join(directory, "docker");
        fs.writeFileSync(docker, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
        const result = run([], {
            ...process.env,
            PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain("Docker is not available");
    });
});
