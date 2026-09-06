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

/**
 * Run, locally, exactly what the Build & Test workflow runs.
 *
 * **The workflow is the statement; this reads it.** A hook holding its own copy
 * of the command list is a second statement of one thing, and the copy is the
 * one that goes stale — silently, because a pre-push check that runs four of
 * five steps still exits 0. So the steps are parsed out of
 * `.github/workflows/build.yml` at run time and there is nothing to keep in
 * step.
 *
 * **It refuses rather than assumes.** If the workflow's shape changes so that
 * no `run:` steps are found, this fails loudly instead of passing having done
 * nothing. A guard that quietly covers nothing is worse than no guard, because
 * it is trusted.
 *
 * **What it cannot run**, and says so: a `uses:` step is a published action, not
 * a command — the forbidden-marker check, the coverage upload. Those stay
 * GitHub's to run, and the summary names them so the gap is visible rather than
 * assumed away.
 *
 * **It parses the workflow itself rather than importing a YAML library**, for a
 * reason that is easy to miss: the *first* step it has to run is `npm ci`, so
 * anything this script imports from `node_modules` is unavailable exactly when
 * it is needed — on a fresh clone, or in a worktree that has never been
 * installed. The parser is therefore deliberately small, and strict: it reads
 * `run:` scalars and `run: |` blocks by indentation and refuses when it
 * recognises nothing.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * The repository whose workflow is being run — the working directory, not this
 * file's package.
 *
 * This ships in `@heroiclands/package-build` and runs against whichever
 * repository invoked it: from a hook, git sets the working directory to the
 * repository root; in the container, it is the mounted export. Resolving
 * relative to `import.meta.url` would find the *package's* own tree, which is
 * never the one under test.
 */
const ROOT = process.cwd();
const WORKFLOW = path.join(ROOT, ".github/workflows/build.yml");

/**
 * The workflow's steps, split into what can be run here and what cannot.
 *
 * @returns {{run: Array<{name: string, run: string}>, skipped: string[]}} The
 *   `run:` steps in workflow order, and the names of the `uses:` steps.
 * @throws {Error} When the workflow cannot be read or declares no `run:` step.
 */
export function ciSteps() {
    const lines = fs.readFileSync(WORKFLOW, "utf8").split("\n");
    const run = [];
    const skipped = [];
    /** The most recent `- name:` seen, which labels whatever step follows. */
    let name = null;

    const indentOf = (line) => line.length - line.trimStart().length;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const text = line.trim();
        if (text.startsWith("#") || text === "") continue;

        const named = /^-?\s*name:\s*(.+)$/.exec(text);
        if (named) {
            name = named[1].replace(/^["']|["']$/g, "");
            continue;
        }
        if (/^-?\s*uses:\s*\S/.test(text)) {
            skipped.push(name ?? text.replace(/^-?\s*uses:\s*/, ""));
            name = null;
            continue;
        }

        const inline = /^-?\s*run:\s*(?!\|)(.+)$/.exec(text);
        if (inline) {
            run.push({ name: name ?? inline[1], run: inline[1].trim() });
            name = null;
            continue;
        }
        // A `run: |` block scalar: every following line indented deeper.
        if (/^-?\s*run:\s*\|\s*$/.test(text)) {
            const base = indentOf(line);
            const body = [];
            while (i + 1 < lines.length) {
                const next = lines[i + 1];
                if (next.trim() !== "" && indentOf(next) <= base) break;
                body.push(next.trim());
                i += 1;
            }
            const command = body.filter(Boolean).join(" && ");
            if (command) run.push({ name: name ?? command, run: command });
            name = null;
        }
    }
    if (!fs.existsSync(WORKFLOW)) {
        throw new Error(
            `${path.relative(ROOT, WORKFLOW)} does not exist — this repository ` +
                `declares no Build & Test workflow at the path this reads, so there ` +
                `is nothing to check. Point it at the right file rather than ` +
                `reporting success having run nothing.`,
        );
    }
    if (!run.length) {
        throw new Error(
            `${path.relative(ROOT, WORKFLOW)} declares no \`run:\` steps — either the ` +
                `workflow moved or its shape changed. Refusing to report success ` +
                `having run nothing; fix this script rather than skipping the check.`,
        );
    }
    return { run, skipped };
}

/**
 * Run every step, stopping at the first failure.
 *
 * Stopping is deliberate and mirrors the runner: a later step routinely depends
 * on an earlier one having produced something.
 *
 * @returns {number} The exit code to leave with.
 */
function main() {
    let steps;
    try {
        steps = ciSteps();
    } catch (err) {
        console.error(`ci-steps: ${err.message}`);
        return 1;
    }

    const { run, skipped } = steps;
    console.log(`ci-steps: running ${run.length} step(s) from .github/workflows/build.yml`);
    if (skipped.length) {
        console.log(`ci-steps: not runnable here (published actions): ${skipped.join(", ")}`);
    }

    for (const [i, step] of run.entries()) {
        console.log(`\nci-steps: [${i + 1}/${run.length}] ${step.name}\n  $ ${step.run}`);
        const result = spawnSync(step.run, { cwd: ROOT, shell: true, stdio: "inherit" });
        if (result.status !== 0) {
            console.error(
                `\nci-steps: FAILED at "${step.name}" — this is what GitHub would report.\n` +
                    `  Fix it, or push with --no-verify if you mean to.`,
            );
            return result.status ?? 1;
        }
    }
    console.log(`\nci-steps: all ${run.length} step(s) passed.`);
    return 0;
}

// Compared as *real* paths: a consumer reaches this through
// `node_modules/@heroiclands/package-build`, which npm may make a symlink, and
// `import.meta.url` is symlink-resolved while `process.argv[1]` is not. Comparing
// them raw makes the module exit 0 having done nothing — silently, which is the
// worst way for a check to fail.
const invokedDirectly = (() => {
    try {
        return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
})();
if (invokedDirectly) process.exit(main());
