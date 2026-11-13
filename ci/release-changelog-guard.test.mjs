/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const yaml = createRequire(import.meta.url)("yaml");
const workflow = yaml.parse(fs.readFileSync(".gitea/workflows/build.yml", "utf8"));
const steps = workflow.jobs.light.steps;
const ordinary = steps.find((step) => step.name === "Changeset quality");
const release = steps.find((step) => step.name === "Release changelog quality");
const cli = path.resolve("bin/package-build.mjs");
const guard = path.resolve("ci/release-changelog-guard.mjs");

function run(step, cwd) {
    assert.match(step.run, /^node bin\/package-build\.mjs changelog check(?: --release)?$/);
    return spawnSync(process.execPath, [cli, ...step.run.split(" ").slice(2)], {
        cwd,
        encoding: "utf8",
    });
}

test("release branch pull requests enforce release quality alongside ordinary changesets", () => {
    assert.equal(ordinary.run, "node bin/package-build.mjs changelog check");
    assert.equal(release.run, "node ci/release-changelog-guard.mjs");
    assert.deepEqual(release.env, {
        RELEASE_EVENT: "${{ github.event_name }}",
        RELEASE_HEAD: "${{ github.event.pull_request.head.ref }}",
    });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-"));
    try {
        fs.mkdirSync(path.join(directory, ".changeset"));
        fs.writeFileSync(
            path.join(directory, ".changeset", "config.json"),
            JSON.stringify({ changelog: ["generator", { labels: ["Content"] }] }),
        );
        fs.writeFileSync(
            path.join(directory, ".changeset", "change.md"),
            '---\n"sample": patch\n---\n\n**Content**\n\n- A useful change.\n',
        );
        const changelog = `# Package\n\n## 1.0.0\n\n**Content**\n\n${Array.from({ length: 16 }, (_, i) => `- Change ${i}.`).join("\n")}\n`;
        fs.writeFileSync(path.join(directory, "CHANGELOG.md"), changelog);
        assert.equal(run(ordinary, directory).status, 0);
        const invoke = (event, head) =>
            spawnSync(process.execPath, [guard], {
                cwd: directory,
                encoding: "utf8",
                env: { ...process.env, RELEASE_EVENT: event, RELEASE_HEAD: head },
            });
        const result = invoke("pull_request", "changeset-release/main");
        assert.equal(result.status, 1);
        assert.match(result.stderr, /too-many-bullets/);
        assert.equal(fs.readFileSync(path.join(directory, "CHANGELOG.md"), "utf8"), changelog);
        for (const [event, head] of [
            ["push", "changeset-release/main"],
            ["pull_request", "feature/source"],
            ["pull_request", ""],
            ["", ""],
            ["pull_request", "changeset-release/main; exit 1"],
        ]) {
            assert.equal(invoke(event, head).status, 0);
            assert.equal(run(ordinary, directory).status, 0);
        }
        fs.writeFileSync(
            path.join(directory, ".changeset", "change.md"),
            "Not a valid changeset.\n",
        );
        assert.equal(run(ordinary, directory).status, 1);
        fs.writeFileSync(
            path.join(directory, "CHANGELOG.md"),
            "# Package\n\n## 1.0.0\n\n**Content**\n\n- A useful change.\n",
        );
        assert.equal(invoke("pull_request", "changeset-release/main").status, 0);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
