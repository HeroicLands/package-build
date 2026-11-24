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
 * The order of the Texinfo manual, as paths relative to `docs/`.
 *
 * The first entry is the Top node; every other entry is a chapter, in reading
 * order. An entry written as an object attaches further pages inside its
 * chapter: each attached page's title becomes a node at the level of the
 * heading whose anchor `after` names, placed after that heading's section.
 *
 * Every Markdown page under `docs/` appears here exactly once, and a test
 * holds the list to that.
 *
 * @typedef {{file: string, after: string}} Attachment
 * @typedef {string | {file: string, attach: Attachment[]}} ManifestEntry
 * @type {ReadonlyArray<ManifestEntry>}
 */
export const MANIFEST = Object.freeze([
    "index.md",
    "getting-started.md",
    "design.md",
    "project-setup.md",
    "guides/system-project.md",
    "guides/module-project.md",
    "content-format.md",
    "authoring/first-note.md",
    "authoring/frontmatter.md",
    "authoring/links-and-markup.md",
    "authoring/assets.md",
    "authoring/dates-and-calendars.md",
    "guides/packs.md",
    "guides/site.md",
    "reference/theme-pages.md",
    "guides/book.md",
    "guides/icons.md",
    "guides/reference-pages.md",
    "guides/localization.md",
    "guides/e2e.md",
    "guides/release-and-deploy.md",
    "guides/writing-in-invented-scripts.md",
    "encoding-core.md",
    "source-preview.md",
    {
        file: "commands.md",
        attach: [{ file: "commands/vehicle.md", after: "package-build-vehicle" }],
    },
    "configuration.md",
    "diagnostics.md",
    "api.md",
    "reference/note-types.md",
    "reference/format-details.md",
    "reference/azgaar-map-input.md",
    "reference/settlement-inputs.md",
    "reference/settlement-model.md",
    "reference/settlement-proposals.md",
    "reference/settlement-placement.md",
    "reference/settlement-urban.md",
    "reference/settlement-names.md",
    "reference/settlement-source.md",
]);

/**
 * Every page a manifest names, attached pages included, in manifest order.
 * @param {ReadonlyArray<ManifestEntry>} [manifest]
 * @returns {string[]}
 */
export function manifestFiles(manifest = MANIFEST) {
    return manifest.flatMap((entry) =>
        typeof entry === "string" ?
            [entry]
        :   [entry.file, ...(entry.attach || []).map(({ file }) => file)],
    );
}
