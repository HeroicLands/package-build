/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Build the calendar files a content package ships to Foundry. */

import fs from "node:fs";
import path from "node:path";

import { calendariaEnvelope, compileCalendars } from "./calendar-notes.mjs";
import { formatDiagnostic, positionOfFrontmatterPath } from "./diagnostics.mjs";
import { authoredFrontmatter, isNoteRecord, noteFile } from "./index-records.mjs";
import { metadataFileName } from "./packages.mjs";

// The import envelope requires an ISO instant. A fixed value keeps an export
// reproducible from its source rather than stamping the build machine's clock.
const EXPORT_EPOCH = "1970-01-01T00:00:00.000Z";

/** @param {string} file @param {string} message @param {string} raw @param {string[]} keyPath */
function failAt(file, message, raw, keyPath) {
    const position = positionOfFrontmatterPath(raw, keyPath, { key: true });
    const error = new Error(formatDiagnostic({ file, ...position, severity: "error", message }));
    error.located = true;
    throw error;
}

/** @param {string} file */
function readIndex(file) {
    const display = path.relative(process.cwd(), file) || file;
    if (!fs.existsSync(file)) {
        const error = new Error(
            `${display}: error: content index is absent; run package-build content-index`,
        );
        error.located = true;
        throw error;
    }
    const records = fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line, index) => {
            try {
                return JSON.parse(line);
            } catch (cause) {
                const error = new Error(
                    `${display}:${index + 1}: error: invalid content index record`,
                    {
                        cause,
                    },
                );
                error.located = true;
                throw error;
            }
        });
    if (!records.some(isNoteRecord)) {
        const error = new Error(`${display}: error: content index contains no notes`);
        error.located = true;
        throw error;
    }
    return records;
}

/**
 * Emit calendar definitions and import envelopes from the package's index.
 *
 * @param {object} opts
 * @param {object} opts.config - Resolved content configuration.
 * @param {string} opts.calendariaVersion - Version whose import format is targeted.
 * @returns {{directory: string, calendars: number, files: number}}
 */
export function emitCalendarArtifacts({ config, calendariaVersion } = {}) {
    if (!config) throw new Error("calendar emission requires a content configuration");
    if (!/^\d+\.\d+\.\d+$/.test(calendariaVersion ?? "")) {
        throw new Error("calendar emission requires a Calendaria version such as 1.4.2");
    }

    const root = config.rootDir;
    const contentBase = path.resolve(root, config.paths.content);
    const indexFile = path.resolve(
        root,
        config.paths.contentIndex,
        metadataFileName(config.contentPackage),
    );
    const directory = path.resolve(root, "build/calendars");
    const notes = readIndex(indexFile)
        .filter(isNoteRecord)
        .map((record) => ({
            fm: authoredFrontmatter(record),
            file: path.relative(root, noteFile(contentBase, record)),
            rel: record.file.path,
        }));
    const calendars = notes.filter(
        (note) =>
            String(note.fm.type).toLowerCase() === "lore" &&
            String(note.fm.subType).toLowerCase() === "calendar",
    );
    const names = new Map();
    for (const note of calendars) {
        const raw = fs.readFileSync(path.resolve(root, note.file), "utf8");
        const shortcode = note.fm.shortcode;
        if (typeof shortcode !== "string" || !/^[a-z0-9]+$/.test(shortcode)) {
            failAt(
                note.file,
                "calendar shortcode must contain lowercase ASCII letters and digits",
                raw,
                ["shortcode"],
            );
        }
        if (names.has(shortcode)) {
            failAt(
                note.file,
                `calendar shortcode ${shortcode} also occurs in ${names.get(shortcode)}`,
                raw,
                ["shortcode"],
            );
        }
        names.set(shortcode, note.file);
    }

    const compiled = compileCalendars({ notes }, { contentPackage: config.contentPackage });
    if (compiled.calendars.length !== calendars.length) {
        const note = calendars[0];
        failAt(
            note.file,
            "calendar notes require a world note declaring data.year",
            fs.readFileSync(path.resolve(root, note.file), "utf8"),
            ["subType"],
        );
    }
    const outputs = [];
    for (let index = 0; index < calendars.length; index++) {
        const shortcode = calendars[index].fm.shortcode;
        const definition = compiled.calendars[index];
        outputs.push([`${shortcode}.json`, definition]);
        outputs.push([
            `${shortcode}.calendaria.json`,
            calendariaEnvelope(definition, {
                version: calendariaVersion,
                exportedAt: EXPORT_EPOCH,
            }),
        ]);
    }

    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
    for (const [name, value] of outputs) {
        fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
    }
    return { directory, calendars: calendars.length, files: outputs.length };
}
