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
 * Whether a vendored manifest can still be *addressed*, as distinct from read.
 *
 * A consuming build vendors each foreign package's link manifest and resolves
 * cross-package links through it. The lookup is by canonical key, so it needs
 * both sides to agree on the key's shape: when they agree the link resolves,
 * and when they drift apart the lookup cannot match on *any* input — while the
 * page still reads correctly, because an unresolved wikilink falls through to
 * its own display text. That is how a v3 key change left one repository reading
 * 2,367 entries through a lookup that could never hit one of them (#1499).
 *
 * Bridging the lookup is not enough on its own: it fails silently again the next
 * time either side moves. So the shapes are *checked* rather than merely
 * converted, and a manifest that yields no addressable key at all fails the
 * build. A lookup that cannot match anything reports nothing, which is the one
 * failure a dead-link check can never catch.
 *
 * This guards {@link kbManifest}'s own key format, which is why it lives beside
 * it rather than in whichever consumer happens to load a manifest.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { formatDiagnostic, positionOfLiteral } from "./diagnostics.mjs";
import { readCanonicalKey } from "./kb-manifest.mjs";

/**
 * Every foreign package whose manifest entries a build cannot address.
 *
 * A package is reported only when it contributes entries and **none** of them
 * yields a readable canonical key — the total, silent failure described above.
 * Partial drift is deliberately not reported here: it resolves something, and
 * whatever it fails to resolve surfaces as an ordinary dead address, pointed at
 * the note that cites it. A package contributing no entries at all is likewise
 * not a finding; a pack-only package publishes no addressable pages by design
 * (#1516), and one being brought up publishes nothing yet.
 *
 * @param {Map<string, {package?: string}>} foreignIndex - `foreign.index` as
 *   returned by `loadForeignManifests`, keyed by canonical key.
 * @returns {Array<{package: string, entries: number, sampleKey: string}>} One
 *   finding per drifted package, in the order the index first names each.
 */
export function unaddressableForeignPackages(foreignIndex) {
    const byPackage = new Map();
    for (const [key, value] of foreignIndex ?? new Map()) {
        // The package is read from the entry rather than the key, since the key
        // is the very thing under suspicion — deriving it from a shape that may
        // not parse would report the finding against `undefined`.
        const pkg = value?.package;
        if (!pkg) continue;
        const seen = byPackage.get(pkg) ?? {
            entries: 0,
            readable: 0,
            sampleKey: key,
        };
        seen.entries += 1;
        if (readCanonicalKey(key)) seen.readable += 1;
        byPackage.set(pkg, seen);
    }

    const findings = [];
    for (const [pkg, seen] of byPackage) {
        if (seen.entries > 0 && seen.readable === 0) {
            findings.push({
                package: pkg,
                entries: seen.entries,
                sampleKey: seen.sampleKey,
            });
        }
    }
    return findings;
}

/**
 * One finding, in the standard `file:line:column: severity: message` form.
 *
 * The position is recovered by locating the offending key in the manifest text:
 * the finding is about a literal the reader can see in the file, so its position
 * is implicit rather than absent. When the file cannot be read, or the key is
 * not in it, the locator degrades to the file alone — a dropped field, never a
 * guessed `1:1` that would send the reader to the top of a 500 KB manifest for a
 * finding that is not there.
 *
 * @param {{package: string, entries: number, sampleKey: string}} finding - One
 *   finding from {@link unaddressableForeignPackages}.
 * @param {string} manifestDir - The directory the manifests were loaded from.
 * @returns {string} The formatted diagnostic, path first on the line.
 */
export function formatUnaddressableFinding(finding, manifestDir) {
    const file = path.join(manifestDir, `${finding.package}.json`);
    let at = {};
    try {
        at = positionOfLiteral(fs.readFileSync(file, "utf8"), `"${finding.sampleKey}"`);
    } catch {
        // Unreadable here is not itself the finding — `loadForeignManifests`
        // already reports that as a stale manifest. The file is simply all that
        // is known about where this one is.
    }
    return formatDiagnostic({
        file,
        ...at,
        severity: "error",
        message:
            "no key in this manifest is a canonical " +
            `\`package-type-shortcode\` address (${finding.entries} ` +
            `${finding.entries === 1 ? "entry" : "entries"}, none addressable; ` +
            `first is \`${finding.sampleKey}\`) — every cross-package link to ` +
            `${finding.package} would resolve to nothing, silently`,
    });
}
