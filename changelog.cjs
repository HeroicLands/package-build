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
 * The Changesets changelog generator every HeroicLands repository configures
 * as `"changelog": "@heroiclands/package-build/changelog"`.
 *
 * Every built-in generator writes a commit hash into the release line
 * whenever it knows the commit, which it always does in this org's
 * squash-merge workflow — `@changesets/cli/changelog` writes `- <hash>: `,
 * and `@changesets/changelog-git` adds a link on top of it. A commit hash is
 * a commit-log artefact, not something the person installing the package
 * needs, and the writing conventions keep tracker and commit references out
 * of the tree. `getReleaseLine` writes the changeset's summary and nothing
 * else; `getDependencyReleaseLine` writes nothing, because none of these
 * packages narrate an internal dependency bump.
 *
 * Changesets loads a changelog generator with `require`, so this is
 * CommonJS in a package that is otherwise `"type": "module"`.
 *
 * @module
 */

/**
 * @param {{summary: string}} changeset - The pending changeset. Only
 *   `summary` is read; a known `commit` is deliberately ignored.
 * @returns {string} The summary as a release line — its first line as the
 *   bullet, every following line indented two spaces under it, blank lines
 *   preserved.
 */
function getReleaseLine(changeset) {
    const [firstLine, ...restLines] = changeset.summary.split("\n").map((line) => line.trimEnd());
    let releaseLine = `- ${firstLine}`;
    if (restLines.length > 0) {
        releaseLine += `\n${restLines.map((line) => (line.length > 0 ? `  ${line}` : line)).join("\n")}`;
    }
    return releaseLine;
}

/**
 * @returns {string} Always empty — these packages have no internal
 *   dependency bumps to narrate.
 */
function getDependencyReleaseLine() {
    return "";
}

module.exports = { getReleaseLine, getDependencyReleaseLine };
