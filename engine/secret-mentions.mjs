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
 * **Public mentions of a secret membership.**
 *
 * A being's `data.affiliations` entry marked `secret: true` is a fact only the
 * GM sees, so the note's public prose must not name the body either. A wikilink
 * to the body outside a `:::secret` block and a `.secret` section is a finding;
 * inside either it is legitimate GM text.
 *
 * @module
 */

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { splitFrontmatter } from "./diagnostics.mjs";
import { withheldSections } from "./heading-attributes.mjs";
import { secretBodies } from "./standings.mjs";
import { parseWikilink } from "./wikilink-syntax.mjs";
import { WIKILINK } from "./wikilink-pattern.mjs";

/**
 * Findings for each wikilink to a secret body in a being's public prose.
 *
 * @param {object} note - The note, with its whole file in `raw`.
 * @param {{index?: object}} [options] - The lint's options.
 * @returns {object[]} Located findings.
 */
export function checkSecretMentions(note, { index } = {}) {
    const context = {
        package: index?.contentPackage,
        types: index?.types,
        packages: index?.packages,
    };
    const secret = secretBodies(note.fm?.data?.affiliations, context);
    if (!secret.size) return [];
    const raw = String(note.raw ?? "");
    const split = splitFrontmatter(raw);
    if (!split) return [];
    const body = split.body;
    const bodyLine = raw.slice(0, raw.length - body.length).split("\n").length;

    const lines = body.split("\n");
    const hidden = new Set();
    for (const block of scanBlocks(body).blocks)
        if (block.name === "secret")
            for (let line = block.start; line <= block.end; line++) hidden.add(line);
    for (const section of withheldSections(body, bodyLine).sections)
        for (let line = section.start; line < section.end; line++) hidden.add(line);

    const findings = [];
    lines.forEach((text, line) => {
        if (hidden.has(line)) return;
        for (const match of text.matchAll(WIKILINK)) {
            const { target } = parseWikilink(match[1], match[0]);
            if (!target) continue;
            const tuple = parseAddress(
                target,
                { ...context, system: "note", type: "affiliation" },
                { declared: true },
            );
            if (!isAddressTuple(tuple) || !secret.has(renderAddress(tuple))) continue;
            findings.push({
                file: note.file,
                line: bodyLine + line,
                column: match.index + 1,
                severity: "error",
                message:
                    `the link ${match[0]} names ${renderAddress(tuple)}, a body this being's ` +
                    "`data.affiliations` marks `secret: true`; state the membership only " +
                    "inside a `:::secret` block or a `.secret` section",
            });
        }
    });
    return findings;
}
