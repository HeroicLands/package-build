/* SPDX-License-Identifier: GPL-3.0-or-later */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

/**
 * A configuration named through a symlinked directory resolves to the same
 * root as the working directory, so diagnostics name files relative to it.
 */
const CLI = path.resolve(__dirname, "../bin/package-build.mjs");

let base: string;
let real: string;
let link: string;

beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "config-symlink-")));
    real = path.join(base, "real");
    link = path.join(base, "link");
    fs.mkdirSync(path.join(real, "assets/content/Lore"), { recursive: true });
    fs.writeFileSync(
        path.join(real, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(real, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: modules
compatibility: { minimum: "14.359", verified: "14.359" }
stats: { lastModifiedBy: preflightbuild00 }
packs:
  - { name: journals, type: JournalEntry, default: true }
publish: {}
pdf: { books: [{ id: core, title: Demo, document: book.yaml }] }
`,
    );
    fs.writeFileSync(
        path.join(real, "assets/content/Lore/Osket.md"),
        "---\nname: { full: Osket }\nshortcode: osket\ntype: lore\nsubType: history\ndescription: A note.\n---\n\nBody.\n",
    );
    fs.symlinkSync(real, link);
});

afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
});

const run = (config: string) => {
    const result = spawnSync(process.execPath, [CLI, "lint"], {
        cwd: real,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: config },
        encoding: "utf8",
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n");
};

describe("PACKAGE_BUILD_CONFIG named through a symlinked directory", () => {
    it(
        "yields diagnostic paths relative to the working directory",
        () => {
            const lines = run(path.join(link, "package-build.config.yaml"));
            const findings = lines.filter((line) => /: (error|warning): /.test(line));
            expect(findings.length).toBeGreaterThan(0);
            expect(findings.filter((line) => line.includes("Osket.md"))[0]).toMatch(
                /^assets\/content\/Lore\/Osket\.md:/,
            );
            for (const line of findings) expect(line).not.toMatch(/^\.\./);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "still names a missing configuration as given",
        () => {
            const missing = path.join(link, "absent.yaml");
            expect(run(missing).join("\n")).toContain(`names ${missing}, which does not exist`);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
