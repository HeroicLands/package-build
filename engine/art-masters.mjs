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

/** Private image inputs keyed by their embedded address. */
import fs from "node:fs";
import path from "node:path";
import { readCanonicalKey } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import { readProvenance, readSvgProvenance, sniffFormat } from "./art-provenance.mjs";

/**
 * Read each PNG and SVG in the configured roots once.
 * @param {readonly string[]} roots Private input directories.
 * @param {string} contentPackage The package owning the inputs.
 * @returns {{masters: Map<string, {file: string, record: import('./art-provenance.mjs').ProvenanceRecord}>, findings: object[]}} Parsed masters and located findings.
 */
export function collectArtMasters(roots, contentPackage) {
    const masters = new Map();
    const findings = [];
    const reported = new Set();
    const add = (file, message) =>
        findings.push({ file, line: 1, column: 1, severity: "error", message });
    const visit = (dir) => {
        let entries;
        try {
            entries = fs
                .readdirSync(dir, { withFileTypes: true })
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            add(dir, `cannot read master directory: ${error.message}`);
            return;
        }
        for (const entry of entries) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(file);
                continue;
            }
            if (
                !entry.isFile() ||
                ![".png", ".svg"].includes(path.extname(entry.name).toLowerCase())
            )
                continue;
            try {
                const bytes = fs.readFileSync(file);
                const format = sniffFormat(bytes);
                const expected = path.extname(entry.name).slice(1).toLowerCase();
                if (format !== expected)
                    throw new Error(`expected ${expected.toUpperCase()} input`);
                const { record, xmp, standard } =
                    format === "png" ? readProvenance(bytes) : readSvgProvenance(bytes);
                if (xmp.derived !== undefined)
                    throw new Error("a master must not carry hl:derived");
                if (xmp.address && xmp.identifier && xmp.address !== xmp.identifier)
                    throw new Error("hl:address and dc:identifier differ");
                const address = xmp.address ?? xmp.identifier ?? standard.address;
                if (!address) throw new Error("master address is missing");
                const tuple = readCanonicalKey(address);
                if (
                    !tuple ||
                    !Object.values(tuple).every(isAddressSegment) ||
                    tuple.package !== contentPackage ||
                    tuple.system !== "none" ||
                    !["image", "icon"].includes(tuple.type)
                )
                    throw new Error("master address must name an image or icon in this package");
                const previous = masters.get(address);
                if (previous) {
                    if (!reported.has(address)) {
                        add(previous.file, "duplicate master address");
                        reported.add(address);
                    }
                    add(file, "duplicate master address");
                } else masters.set(address, { file, record });
            } catch (error) {
                add(file, error.message);
            }
        }
    };
    for (const root of roots) visit(root);
    return { masters, findings };
}
