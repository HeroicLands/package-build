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

/** On-demand coverage of this package's item notes for a system. @module */

import fs from "node:fs";
import path from "node:path";
import { noteAddress } from "./content-index.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isNoteRecord, noteFile } from "./index-records.mjs";
import { ITEM_NOTE_TYPES } from "./item-entries.mjs";
import { declaredSystems } from "./system-vocabulary.mjs";

/**
 * Group item notes without a system block by their declared kind.
 *
 * @param {object} config - Resolved package configuration.
 * @param {readonly object[]} records - This package's content index records.
 * @param {string} system - Declared system identifier.
 * @param {string} [cwd] - Base for displayed file paths.
 * @returns {{system: string, total: number, groups: object[]}} The coverage report.
 */
export function itemCoverage(config, records, system, cwd = process.cwd()) {
    if (!declaredSystems(config).includes(system)) {
        throw new Error(`System ${system} is not supported by this package`);
    }
    const grouped = new Map();
    for (const record of records) {
        if (!isNoteRecord(record) || !ITEM_NOTE_TYPES.includes(record.type)) continue;
        if (record.package !== config.contentPackage) continue;
        const block = record[system];
        if (block !== null && typeof block === "object" && !Array.isArray(block)) continue;
        const kind = typeof record.data?.kind === "string" ? record.data.kind : "unspecified";
        const absolute = noteFile(config.paths.content, record);
        const raw = fs.readFileSync(absolute, "utf8");
        const position = positionOfFrontmatterPath(raw, ["type"], { key: true });
        const item = {
            file: path.relative(cwd, absolute),
            ...position,
            address: noteAddress(record, config.contentPackage)?.canonical ?? null,
            name: record.name?.full ?? record.shortcode,
        };
        if (!grouped.has(kind)) grouped.set(kind, []);
        grouped.get(kind).push(item);
    }
    const groups = [...grouped]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([kind, items]) => ({
            kind,
            count: items.length,
            items: items.sort((a, b) => a.file.localeCompare(b.file)),
        }));
    return { system, total: groups.reduce((sum, group) => sum + group.count, 0), groups };
}
