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
 * The things the content format asserts that can be checked.
 *
 * `content-format.mjs` reads the specification as data; this compares it
 * against the three worlds it makes claims about — the systems it maps onto,
 * the notes it governs, and the field declarations that compile them.
 *
 * ## The specification against a system's published schema
 *
 * **The format does not define the `sohl:` or `hm3:` schemas.** Each system
 * defines its own, and its published `schema.json` is the authoritative
 * statement of it. So a mapping row is a *claim*: `data.weight` reaches
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
 * document subtype receives it* is the note-type → subtype map, which does not
 * exist yet. Resolving per subtype before that map exists would mean inferring
 * it from the prose around each table, which is precisely the transcription
 * this whole module avoids. So the question asked here is "does any schema
 * declare this field?", and it narrows to the subtype once the map lands.
 *
 * ## The corpus against the declared vocabulary
 *
 * Every authored note is measured against the per-type `data` tables. Three
 * classes of finding come out of them, one per slice of the migration:
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
 * instead, and `--strict` turns them fatal — turned on slice by slice, as each
 * class reaches zero.
 *
 * **What it deliberately does not check.** A key inside a `sohl:` or `hm3:`
 * block that the format says nothing about is left alone: those regions are
 * closed against *the system's* schema, not against this document, and
 * `frontmatter-lint.mjs` already checks them against the declared fields. This
 * module only reports a key whose home the format actually states.
 *
 * ## The specification against the declarations that compile it
 *
 * The specification hand-writes a `data` table under most of its type sections,
 * which is the ground {@link module:engine/field-reference} already generates
 * from the `fields` on each `itemBuilders` entry — the duplication that module's
 * docstring exists to prevent, one document over.
 *
 * **Checked rather than generated, because a merge is not available.** The
 * document's vocabulary spans note types that produce Scenes, Macros and
 * JournalEntries — `place`, `scenario`, `map`, `lore`, `doc`, `macro`,
 * `homepage` — and no `itemBuilders` entry covers any of them, so there is no
 * whole the two halves could be folded into.
 *
 * **What they can be held to is agreement where they both speak.** A mapping row
 * saying `data.weight` reaches `system.weightBase`, and a declaration writing
 * `weight` to `weightBase`, are one statement made twice; a rename that moves
 * only one of them is a defect in one of the two, and that is a fact a build can
 * establish. {@link checkDeclaredFields} fails on exactly that.
 *
 * **The rest is reported, not asserted.** The two vocabularies are not the same
 * set and are not meant to be: the document names the *shared* source a field is
 * written as, while a declaration names every key the system's own block accepts
 * — including the system-specific ones (`heft`, `strikeModes`) that the document
 * correctly never maps. Until the corpus has moved into `data:`, holding the
 * sets equal would report the migration itself as a defect on every run. So the
 * fields only one side names come back as *coverage*, and the types only one side
 * describes come back **named** rather than skipped in silence — a check that
 * quietly compared nine of twenty-three types would read as one that covered
 * them all.
 *
 * @module
 */

import { currentType } from "./ids.mjs";
import { SCHEMA_ARTIFACT_VERSION } from "./schema-check.mjs";
import { authoredFields } from "./field-spec.mjs";
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
 * A shared row names no type, so it is placed rather than typed: "in the shared
 * mappings" instead of "on a `weapongear`". Reading `on a \`the shared
 * mappings\`` would be the alternative, and a diagnostic is prose.
 *
 * @param {object} finding - `{system, systemVersion, noteType, source, target, shared}`.
 * @returns {string} The message.
 */
export function undeclaredTargetMessage({
    system,
    systemVersion,
    noteType,
    source,
    target,
    shared,
}) {
    const where = shared ? `in ${noteType}` : `on a \`${noteType}\``;
    return (
        `the format maps \`${source}\` ${where} to \`${target}\` in ` +
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
    new Set(["id", "type", "subType", "shortcode", "description", "tags", "name"]),
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

    // The specification's sections are headed by the current spelling of a note
    // type, so a note still on a renamed one is measured against the section it
    // will move to rather than reported as a type the format does not declare.
    // The rename itself is the frontmatter lint's finding.
    const spec = format.types.get(currentType(type));
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
 * The counts are the point as much as the findings: a class is promoted to
 * fatal when its count reaches zero, so a run that prints them is the
 * migration's progress bar.
 *
 * @param {Iterable<object>} notes - `{file, raw, fm}` for each authored note.
 * @param {import("./content-format.mjs").ContentFormat} format - The parsed
 *   specification.
 * @param {object} [opts]
 * @param {boolean} [opts.strict=false] - Report the findings as errors rather
 *   than warnings. Turned on one slice at a time.
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

/**
 * Where one declared field sends one authored value.
 *
 * @typedef {object} FieldPair
 * @property {string} name - The authored key, as the declaration spells it.
 * @property {string} to - The emitted path, `system.` prefix stripped.
 */

/**
 * `path` read as `prefix`, or as a key beneath it.
 *
 * Matching on whole segments rather than on characters, so `charge` is not a
 * prefix of `charges` — a substring match would pair two unrelated fields and
 * then report their destinations as a contradiction.
 *
 * @param {string} path - The dotted path.
 * @param {string} prefix - The candidate prefix.
 * @returns {string|undefined} The remainder — `""` for an exact match, `.value`
 *   for a key beneath it — or `undefined` when `path` does not sit under it.
 */
function under(path, prefix) {
    if (path === prefix) return "";
    if (path.startsWith(`${prefix}.`)) return path.slice(prefix.length);
    return undefined;
}

/**
 * What an author is told when the specification and the declaration disagree.
 *
 * @param {object} finding - `{noteType, source, target, name, to}`.
 * @returns {string} The message.
 */
export function fieldDriftMessage({ noteType, source, target, name, to }) {
    return (
        `the format maps \`${source}\` on a \`${noteType}\` to \`${target}\`, ` +
        `but the \`${noteType}\` field declaration writes \`${name}\` to ` +
        `\`system.${to}\` — the specification and the declaration that compiles ` +
        `it disagree, and one of the two is wrong`
    );
}

/**
 * A shared source, as the two sides spell it.
 *
 * The specification writes every type-specific row `data.<key>` — the container
 * `data:` put those facts in — while a declaration writes either: the
 * bare key it has always named, or the same dotted path now that a field can
 * declare its shared source and its legacy in-block key separately.
 * Both are the same source, so both are normalized before they are compared;
 * matching one spelling against the other would report every moved field as
 * unmapped, which is the opposite of what this check is for.
 *
 * A note-level source — the `subType` several tables name — carries no prefix
 * and is returned unchanged.
 *
 * @param {string} path - The source, as either side wrote it.
 * @returns {string} The source without its `data.` prefix.
 */
function sharedSource(path) {
    return String(path).replace(/^data\./, "");
}

/**
 * The specification's mapping rows for one type and one system, as field paths.
 *
 * @param {import("./content-format.mjs").ContentFormat} format - The parsed
 *   specification.
 * @param {string} noteType - The type whose section to read.
 * @param {string} system - The system column to read.
 * @returns {import("./content-format.mjs").MappingClaim[]} Its claims.
 */
function claimsFor(format, noteType, system) {
    return format.claims.filter((c) => c.noteType === noteType && c.system === system);
}

/**
 * Check the specification's per-type tables against the field declarations that
 * compile them.
 *
 * @param {object} opts
 * @param {import("./content-format.mjs").ContentFormat} opts.format - The
 *   parsed specification.
 * @param {Record<string, readonly object[]>} opts.itemFields - Item type → its
 *   `fields` declaration, as `itemBuilders` carries it.
 * @param {string} opts.system - Which system column of the mapping tables these
 *   declarations compile. Supplied by the caller rather than assumed here: the
 *   declarations belong to one system, and the document maps onto several.
 * @param {"warning"|"error"} [opts.severity="error"] - What a contradiction is.
 * @returns {{findings: object[], coverage: object[], checked: string[],
 *   skipped: {spec: string[], registry: string[]}, fields: number}}
 *   Contradictions ready for `emitDiagnostic`, the per-type coverage, the types
 *   compared, the types out of reach on each side, and how many field pairs
 *   were compared.
 */
export function checkDeclaredFields({ format, itemFields, system, severity = "error" }) {
    const declared = itemFields ?? {};
    const findings = [];
    const coverage = [];
    const checked = [];
    const skippedSpec = [];
    const skippedRegistry = [];
    let fields = 0;

    for (const noteType of format.types.keys()) {
        if (!declared[noteType]) {
            skippedSpec.push(noteType);
            continue;
        }
        checked.push(noteType);

        const authored = authoredFields(declared[noteType]);
        for (const claim of claimsFor(format, noteType, system)) {
            const source = sharedSource(claim.source);
            const target = claim.target.replace(/^system\./, "");
            // The longest declared name that the source sits under: a field
            // declared `impact.die` claims `data.impact.die` ahead of any
            // field declared `impact`. Compared on the normalized spelling, so
            // a field that has moved its source under `data:` is the same
            // length it was.
            let match;
            let rest;
            let matched = "";
            for (const field of authored) {
                const name = sharedSource(field.name);
                const remainder = under(source, name);
                if (remainder === undefined) continue;
                if (match && name.length <= matched.length) continue;
                match = field;
                matched = name;
                rest = remainder;
            }
            // No declaration names it. That is coverage, not a contradiction —
            // the specification maps fields no builder emits yet, which is the
            // ordinary mid-migration state and what `schema-check.mjs`
            // already reports as unemitted.
            if (!match) continue;
            fields += 1;
            if (under(target, match.to) === rest) continue;
            findings.push({
                file: format.file,
                line: claim.line,
                ...(claim.column === undefined ? {} : { column: claim.column }),
                severity,
                class: "field-drift",
                message: fieldDriftMessage({
                    noteType,
                    source: claim.source,
                    target: claim.target,
                    name: match.name,
                    to: match.to,
                }),
            });
        }

        // The two vocabularies, side by side. Reported rather than asserted
        // equal: the document names the *shared* source a field is written as,
        // and a declaration names every key the system's own block accepts, so
        // the sets legitimately differ until the corpus has moved.
        const registryKeys = new Set(
            authored.map((field) => sharedSource(field.name).split(".")[0]),
        );
        const specKeys = format.types.get(noteType).dataKeys;
        coverage.push({
            type: noteType,
            specOnly: [...specKeys].filter((key) => !registryKeys.has(key)).sort(),
            registryOnly: [...registryKeys].filter((key) => !specKeys.has(key)).sort(),
        });
    }

    for (const type of Object.keys(declared)) {
        if (!format.types.has(type)) skippedRegistry.push(type);
    }

    return {
        findings,
        coverage,
        checked,
        skipped: { spec: skippedSpec, registry: skippedRegistry },
        fields,
    };
}
