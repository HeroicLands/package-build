/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterAll, expect, it } from "vitest";
import { cacheNavigation, fixtureConfig } from "./helpers/parity";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "site-progress-")));
fs.cpSync(new URL("./fixtures/site-search/", import.meta.url), root, { recursive: true });
cacheNavigation(fixtureConfig(root));
const cli = new URL("../bin/package-build.mjs", import.meta.url).pathname;
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

it(
    "reports the full build's phases and cheap counts on stdout",
    () => {
        const result = spawnSync(process.execPath, [cli, "site", "build"], {
            cwd: root,
            encoding: "utf8",
            timeout: SUBPROCESS_TEST_TIMEOUT,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toMatch(
            /indexing content[\s\S]*rendering \d+ page\(s\)[\s\S]*writing \d+ page\(s\)[\s\S]*building the search index[\s\S]*indexed \d+ page\(s\)/,
        );
        expect(result.stderr).not.toMatch(
            /indexing content|rendering \d+ page|writing \d+ page|building the search index/,
        );
    },
    SUBPROCESS_TEST_TIMEOUT,
);

it(
    "keeps located diagnostics on stderr when a build fails",
    () => {
        const note = path.join(root, "assets/content/Places/portlow.md");
        fs.appendFileSync(note, "\n[[place-missing|Missing]].\n");
        const result = spawnSync(process.execPath, [cli, "site", "build"], {
            cwd: root,
            encoding: "utf8",
            timeout: SUBPROCESS_TEST_TIMEOUT,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("indexing content");
        expect(result.stderr).toMatch(/assets\/content\/Places\/portlow\.md:\d+:\d+: error:/);
        expect(result.stdout).not.toContain(": error:");
    },
    SUBPROCESS_TEST_TIMEOUT,
);

it(
    "prints the listening address before the first build phase and shuts down after a failed build",
    async () => {
        const child = spawn(process.execPath, [cli, "site", "serve", "--port", "0"], {
            cwd: root,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const exited = new Promise((resolve) => child.once("exit", resolve));
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`preview timed out: ${stdout}\n${stderr}`)),
                    SUBPROCESS_TEST_TIMEOUT,
                );
                child.stdout.on("data", (chunk) => {
                    stdout += chunk;
                });
                child.stderr.on("data", (chunk) => {
                    stderr += chunk;
                    if (stderr.includes(": error:")) {
                        clearTimeout(timer);
                        resolve();
                    }
                });
                child.once("error", reject);
                child.once("exit", () => {
                    clearTimeout(timer);
                    reject(new Error(`preview exited early: ${stdout}\n${stderr}`));
                });
            });
            expect(stdout).toMatch(/serving http:\/\/127\.0\.0\.1:\d+\/searchdemo\//);
            expect(stdout.indexOf("serving http:")).toBeLessThan(
                stdout.indexOf("indexing content"),
            );
            expect(stderr).toMatch(/portlow\.md:\d+:\d+: error:/);
        } finally {
            child.kill("SIGTERM");
            await exited;
        }
    },
    SUBPROCESS_TEST_TIMEOUT,
);

it(
    "exits with a failure when the listening HTTP worker stops unexpectedly",
    () => {
        const preload = `import { createRequire, syncBuiltinESMExports } from 'node:module';
        const threads = createRequire(process.cwd() + '/worker-probe.mjs')('node:worker_threads');
        const NativeWorker = threads.Worker;
        threads.Worker = class extends NativeWorker {
            constructor(...args) { super(...args); setTimeout(() => this.terminate(), 500); }
        };
        syncBuiltinESMExports();`;
        const result = spawnSync(
            process.execPath,
            [
                "--import",
                `data:text/javascript,${encodeURIComponent(preload)}`,
                cli,
                "site",
                "serve",
                "--port",
                "0",
            ],
            {
                cwd: root,
                encoding: "utf8",
                timeout: SUBPROCESS_TEST_TIMEOUT,
                env: {
                    ...process.env,
                    PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                },
            },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(1);
        expect(result.stdout).toContain("serving http:");
        expect(result.stderr).toContain("the preview HTTP server stopped");
    },
    SUBPROCESS_TEST_TIMEOUT,
);
