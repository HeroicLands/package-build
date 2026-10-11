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
 * against the two worlds it makes claims about — the systems it maps onto and
 * the field declarations that compile them.
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
 * correctly never maps. Holding the sets equal would report a defect where
 * there is none. So the fields only one side names come back as *coverage*, and the types only one side
 * describes come back **named** rather than skipped in silence — a check that
 * quietly compared nine of twenty-three types would read as one that covered
 * them all.
 *
 * @module
 */

import { SCHEMA_ARTIFACT_VERSION } from "./schema-check.mjs";
import { authoredFields } from "./field-spec.mjs";
import { authoredKey } from "./system-block.mjs";

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
 * @param {{system: string, systemVersion: string, noteType: string, source: string, target: string, shared: boolean}} finding - The unresolved mapping.
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
 * @param {{noteType: string, source: string, target: string, name: string, to: string}} finding - The differing mapping.
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
 * `data:` holds those facts in — while a declaration writes either the bare
 * key or the same dotted path. Both are the same source, so both are
 * normalized before they are compared; matching one spelling against the
 * other would report every field as unmapped, which is the opposite of what
 * this check is for.
 *
 * A note-level source — the `subType` several tables name — carries no prefix
 * and is returned unchanged.
 *
 * **What that normalization cannot see is whether the declaration reads the
 * source at all.** Holding the two spellings equal is right for the question
 * asked here — do the row and the declaration agree about where the value *goes*
 * — and blind to whether the declaration can reach where it *is*. That is
 * `tests/mapped-data-source-is-read.test.ts`, which compares the same pair on
 * the source rather than the target.
 *
 * @param {string} path - The source, as either side wrote it.
 * @returns {string} The source without its `data.` prefix.
 */
const sharedSource = authoredKey;

/**
 * The declaration that compiles one mapping row, and what is left over.
 *
 * The longest declared name the row's source sits under: a field declared
 * `impact.die` claims `data.impact.die` ahead of any field declared `impact`,
 * and a field declared `charges` claims `data.charges.max` with `.max` left
 * over. Compared on the normalized spelling, so a field naming its source under
 * `data:` matches at the same length a bare one does.
 *
 * Exported because two readers ask it and must agree: {@link
 * checkDeclaredFields}, which holds the row's target to the declaration's, and
 * the guard that holds the declaration's *source* to the row's — a second copy
 * of the match would let the two disagree about which declaration a row is even
 * about.
 *
 * @param {string} source - The row's shared source, as either side spells it.
 * @param {readonly object[]} fields - The type's authored declarations.
 * @returns {{field: object, rest: string}|undefined} The declaration and the
 *   remainder of the source beneath its name, or nothing where no declaration
 *   names it.
 */
export function declarationFor(source, fields) {
    const path = sharedSource(source);
    let field;
    let rest;
    let matched = "";
    for (const candidate of fields ?? []) {
        const name = sharedSource(candidate.name);
        const remainder = under(path, name);
        if (remainder === undefined) continue;
        if (field && name.length <= matched.length) continue;
        field = candidate;
        matched = name;
        rest = remainder;
    }
    return field === undefined ? undefined : { field, rest: /** @type {string} */ (rest) };
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
            const target = claim.target.replace(/^system\./, "");
            const found = declarationFor(claim.source, authored);
            // No declaration names it. That is coverage, not a contradiction —
            // the specification maps fields no builder emits, which
            // `schema-check.mjs` already reports as unemitted.
            if (!found) continue;
            const match = found.field;
            fields += 1;
            if (under(target, match.to) === found.rest) continue;
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
