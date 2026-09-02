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
 * The two things the content format asserts that can be checked (#130).
 *
 * `content-format.mjs` reads the specification as data; this compares it
 * against the two worlds it makes claims about — the systems it maps onto, and
 * the notes it governs.
 *
 * ## The specification against a system's published schema
 *
 * **The format does not define the `sohl:` or `hm3:` schemas.** Each system
 * defines its own, and its published `schema.json` is the authoritative
 * statement of it (#127). So a mapping row is a *claim*: `data.weight` reaches
 * `system.weightBase` in SoHL. If SoHL declares no such field the two disagree,
 * and which of them is wrong is a question for a person — but that they
 * disagree is a fact a build can establish.
 *
 * This is {@link module:engine/schema-check}'s idea pointed at prose instead of
 * code. That module compares what a *builder* emits; this compares what the
 * *specification* says a builder should emit, which is the half no build
 * touches and therefore the half that drifts unobserved.
 *
 * **A target is resolved against the union of the system's subtypes.** The
 * mapping tables say which system field a shared source reaches; *which
 * document subtype receives it* is the note-type → subtype map, which is #79's
 * to declare and does not exist yet. Resolving per subtype before that map
 * exists would mean inferring it from the prose around each table, which is
 * precisely the transcription this whole module avoids. So the question asked
 * here is the one #130 states — "does any schema declare this field?" — and it
 * narrows to the subtype when #79 lands.
 *
 * ## The corpus against the declared vocabulary
 *
 * Every authored note is measured against the per-type `data` tables. Three
 * classes of finding come out of them, and each corresponds to a slice of #127:
 *
 * | class | what it means |
 * | --- | --- |
 * | `unknown-type` | the format declares no section for this note's `type` |
 * | `unknown-data-key` | a key in `data:`, which is closed, that the type does not declare |
 * | `top-level-data-key` | a declared `data` property written at top level instead |
 * | `system-block-data-key` | a declared shared source written straight into a system block |
 *
 * **It reports; it does not fail.** All ~6,210 authored notes predate the
 * format, so a failing check would be red on day one in every repository and
 * would stay red for the length of the epic — which is a check nobody can act
 * on and everybody learns to skip. The counts are the migration's progress bar
 * instead, and `--strict` turns them fatal. #127 turns the flag on slice by
 * slice, as each class reaches zero.
 *
 * **What it deliberately does not check.** A key inside a `sohl:` or `hm3:`
 * block that the format says nothing about is left alone: those regions are
 * closed against *the system's* schema, not against this document, and
 * `frontmatter-lint.mjs` already checks them against the declared fields. This
 * module only reports a key whose home the format actually states.
 *
 * @module
 */

import { SCHEMA_ARTIFACT_VERSION } from "./schema-check.mjs";
import { positionInFrontmatter } from "./diagnostics.mjs";

/**
 * Every field path any subtype of a published schema declares.
 *
 * `own` and `inherited` are collapsed here, unlike
 * {@link module:engine/schema-check}, and for the same reason that module keeps
 * them apart: it asks two questions of one artifact and only one of them wants
 * the inherited set. This asks the single question "is this field defined
 * anywhere in the system", for which an inherited field is defined.
 *
 * @param {object} artifact - A `version: 1` schema artifact.
 * @returns {Set<string>} The paths, `system.` prefix stripped as the artifact
 *   stores them.
 */
export function declaredPaths(artifact) {
    const out = new Set();
    for (const subtypes of Object.values(artifact?.documents ?? {})) {
        for (const entry of Object.values(subtypes ?? {})) {
            for (const field of entry?.own ?? []) out.add(field);
            for (const field of entry?.inherited ?? []) out.add(field);
        }
    }
    return out;
}

/**
 * What an author is told about a target no schema declares.
 *
 * Names the version, because a field may be perfectly well defined on the
 * system's `main` and simply unreleased — the same distinction
 * {@link undeclaredMessage} draws, and the difference between "the
 * specification is wrong" and "the schema has not caught up".
 *
 * @param {object} finding - `{system, systemVersion, noteType, source, target}`.
 * @returns {string} The message.
 */
export function undeclaredTargetMessage({ system, systemVersion, noteType, source, target }) {
    return (
        `the format maps \`${source}\` on a \`${noteType}\` to \`${target}\` in ` +
        `${system}, which ${system}@${systemVersion} does not declare on any ` +
        `document subtype — the specification and the system disagree, and one ` +
        `of the two is wrong`
    );
}

/**
 * Check every `system.*` target the specification names.
 *
 * @param {object} opts
 * @param {import("./content-format.mjs").ContentFormat} opts.format - The
 *   parsed specification.
 * @param {Record<string, object>} opts.schemas - System id → its published
 *   `version: 1` schema artifact. A system absent from this map is counted
 *   `unchecked` rather than passed.
 * @returns {{findings: object[], checked: number, unchecked: Record<string, number>}}
 *   Findings ready for `emitDiagnostic`, how many claims were resolved, and how
 *   many were left unresolved per system.
 */
export function checkSchemaTargets({ format, schemas }) {
    /** @type {Record<string, Set<string>>} */
    const declared = {};
    for (const [system, artifact] of Object.entries(schemas ?? {})) {
        if (artifact?.version !== SCHEMA_ARTIFACT_VERSION) {
            throw new Error(
                `package-build: ${system} schema artifact version ` +
                    `${artifact?.version ?? "(absent)"}, expected ` +
                    `${SCHEMA_ARTIFACT_VERSION}. A schema read under the wrong ` +
                    `shape would report confidently in both directions, so the ` +
                    `check stops rather than resolving anyway.`,
            );
        }
        declared[system] = declaredPaths(artifact);
    }

    const findings = [];
    /** @type {Record<string, number>} */
    const unchecked = {};
    let checked = 0;

    for (const claim of format.claims) {
        const paths = declared[claim.system];
        if (!paths) {
            // Named rather than skipped in silence: a check that quietly does
            // nothing reads exactly like one that passed, and HM3 publishes no
            // artifact today, so this branch is the ordinary case for half the
            // document.
            unchecked[claim.system] = (unchecked[claim.system] ?? 0) + 1;
            continue;
        }
        checked += 1;
        if (paths.has(claim.target.replace(/^system\./, ""))) continue;
        findings.push({
            file: format.file,
            line: claim.line,
            ...(claim.column === undefined ? {} : { column: claim.column }),
            severity: "error",
            message: undeclaredTargetMessage({
                ...claim,
                systemVersion: schemas[claim.system]?.systemVersion ?? "(unversioned)",
            }),
        });
    }

    return { findings, checked, unchecked };
}

/**
 * Edit distance, capped — enough to answer "did you mean".
 *
 * The same arithmetic `frontmatter-lint.mjs` carries. Duplicated rather than
 * shared because that module keeps it private and this one is the second
 * caller; the third is the moment to lift it out, not the second.
 *
 * @param {string} a - One string.
 * @param {string} b - The other.
 * @returns {number} The Levenshtein distance.
 */
function distance(a, b) {
    const cols = b.length + 1;
    let prev = Array.from({ length: cols }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
        const row = [i];
        for (let j = 1; j < cols; j += 1) {
            row[j] = Math.min(
                prev[j] + 1,
                row[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        prev = row;
    }
    return prev[cols - 1];
}

/**
 * The declared key an unknown one was most likely meant to be.
 *
 * @param {string} key - The unknown key.
 * @param {Iterable<string>} candidates - The declared keys.
 * @returns {string|undefined} The nearest, when it is near enough to suggest.
 */
function nearest(key, candidates) {
    let best;
    let bestAt = Infinity;
    for (const candidate of candidates) {
        const d = distance(key.toLowerCase(), candidate.toLowerCase());
        if (d < bestAt) {
            bestAt = d;
            best = candidate;
        }
    }
    return bestAt <= Math.max(1, Math.floor(key.length / 3)) ? best : undefined;
}

/**
 * Top-level keys the format names as the note's own, whatever its type.
 *
 * Top level is otherwise **open** — an unrecognised key there is a Hugo or
 * theme parameter this build has no standing to refuse — so this set exists
 * only to keep a note's own identity fields from being mistaken for a
 * misplaced `data` property where the two share a name. `type` and `subType`
 * are the pair that matters: several mapping tables name `subType` as a shared
 * source, and it is authored at top level by design.
 *
 * @type {ReadonlySet<string>}
 */
export const NOTE_LEVEL_KEYS = Object.freeze(
    new Set(["id", "type", "subType", "shortcode", "description", "tags", "name", "aliases"]),
);

/** Whether a value is a plain object a block could be written as. */
function isBlock(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @type {WeakMap<object, ReadonlySet<string>>} */
const systemCache = new WeakMap();

/**
 * The systems the specification names.
 *
 * Taken from the columns of its mapping tables rather than from a list written
 * here, so a system added to the document is measured with no code change.
 * Cached per parsed document, since the answer is the same for every note.
 *
 * @param {import("./content-format.mjs").ContentFormat} format - The parsed
 *   specification.
 * @returns {ReadonlySet<string>} The system ids.
 */
export function systemsNamed(format) {
    let known = systemCache.get(format);
    if (!known) {
        known = new Set(format.claims.map((claim) => claim.system));
        systemCache.set(format, known);
    }
    return known;
}

/**
 * Measure one note against the vocabulary the format declares for its type.
 *
 * @param {object} note - `{file, raw, fm}` — as the link index hands one over.
 * @param {import("./content-format.mjs").ContentFormat} format - The parsed
 *   specification.
 * @param {object} [opts]
 * @param {"warning"|"error"} [opts.severity="warning"] - What the findings are.
 *   A report by default; `--strict` raises it.
 * @returns {object[]} Findings, each carrying the `class` it belongs to
 *   alongside the fields `emitDiagnostic` reads.
 */
export function measureNote(note, format, { severity = "warning" } = {}) {
    const findings = [];
    const fm = note?.fm ?? {};
    const type = String(fm.type ?? "");
    const raw = () => note?.raw ?? "";
    const at = (key, value) => positionInFrontmatter(raw(), key, value);
    const add = (cls, key, message, value) =>
        findings.push({
            file: note?.file,
            ...at(key, value),
            severity,
            class: cls,
            message,
        });

    const spec = format.types.get(type);
    if (!spec) {
        add(
            "unknown-type",
            "type",
            `the content format declares no \`### type: ${type}\` section, so ` +
                `nothing says what this note may write`,
            type,
        );
        return findings;
    }

    // `data:` is closed: every key it carries must be one the type declares.
    const data = isBlock(fm.data) ? fm.data : undefined;
    for (const key of Object.keys(data ?? {})) {
        if (spec.dataKeys.has(key)) continue;
        const guess = nearest(key, spec.dataKeys);
        add(
            "unknown-data-key",
            key,
            `\`data.${key}\` is not a property of a ${type}` +
                (guess ? `. Did you mean "${guess}"?` : ""),
        );
    }

    // The two regions a shared source is written in today, and neither is where
    // the format puts it. Top level is open in general — but a key the type's
    // own table declares is not an unrecognised one, it is one whose home the
    // format states.
    for (const key of spec.dataKeys) {
        if (NOTE_LEVEL_KEYS.has(key)) continue;
        if (Object.hasOwn(fm, key)) {
            add(
                "top-level-data-key",
                key,
                `\`${key}\` is a declared property of a ${type} and belongs in ` +
                    `\`data.${key}\`; at top level it reaches the web page and no ` +
                    `Foundry document`,
            );
        }
        for (const system of systemsNamed(format)) {
            const block = fm[system];
            if (!isBlock(block) || !Object.hasOwn(block, key)) continue;
            add(
                "system-block-data-key",
                key,
                `\`${system}.${key}\` is a declared shared source and belongs in ` +
                    `\`data.${key}\`; a system states an exception under ` +
                    `\`${system}.system\`, not by holding the shared value itself`,
            );
        }
    }

    return findings;
}

/**
 * Measure a corpus, and count what it finds by class.
 *
 * The counts are the point as much as the findings: #127 promotes a class to
 * fatal when its count reaches zero, so a run that prints them is the epic's
 * progress bar.
 *
 * @param {Iterable<object>} notes - `{file, raw, fm}` for each authored note.
 * @param {import("./content-format.mjs").ContentFormat} format - The parsed
 *   specification.
 * @param {object} [opts]
 * @param {boolean} [opts.strict=false] - Report the findings as errors rather
 *   than warnings. #127 turns this on one slice at a time.
 * @returns {{findings: object[], notes: number, byClass: Record<string, number>}}
 */
export function measureCorpus(notes, format, { strict = false } = {}) {
    const findings = [];
    let count = 0;
    for (const note of notes) {
        count += 1;
        findings.push(...measureNote(note, format, { severity: strict ? "error" : "warning" }));
    }
    /** @type {Record<string, number>} */
    const byClass = {};
    for (const finding of findings) {
        byClass[finding.class] = (byClass[finding.class] ?? 0) + 1;
    }
    return { findings, notes: count, byClass };
}
