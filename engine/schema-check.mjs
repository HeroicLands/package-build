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
 * What a builder **emits** into `system`, against what the receiving DataModel
 * **declares** (#60).
 *
 * Foundry discards an unknown `system` key when a document is constructed, and
 * says nothing: the value is simply absent at load, while the build that wrote
 * it reported success. Both directions of that mismatch have already happened
 * here and both compiled clean:
 *
 * - **Emitted, not declared.** `mysticalability` emitted `assocMysteryCode`,
 *   which no DataModel defined — 0.8.x had replaced it with
 *   `assocAffiliationCode` (#35). And `affiliation.subType`, authored on all 21
 *   of `sohl-kethira-basic`'s deities, is not defined at the version that module
 *   targets, so the divine/arcane split evaporates on load.
 * - **Declared, not emitted.** The mirror image, fixed by hand in
 *   content-build#3.
 *
 * Neither was found by tooling. Both were found by set-subtracting compiled
 * documents' `system` keys against `defineSchema()` **by hand**, which is how
 * the next one would have to be found too.
 *
 * **The declared half of the emission is statically known.** A builder *is* its
 * field list — {@link module:engine/field-spec} makes `buildFromFields` the only
 * statement of the mapping — so every `system` path a *declared field* emits is
 * `field.to`. {@link compareFields} needs no compilation to read that.
 *
 * **The rest of the emission is only observable.** A compiler writes keys of
 * its own alongside the declared fields — `shortcode`, `actionDefs`, `notes`,
 * `docHtml`, and since #126 `archetype` — and those appear in neither set
 * {@link compareFields} compares, so nothing compared them at all (#155). They
 * cannot be listed here without the list going stale the next time a compiler
 * grows a key, so they are read off the `system` object the compiler produced:
 * {@link compareEmittedSystem} takes the assembled block and asks what the
 * schema does not declare. That is the same question, against the same schema,
 * with the emitted set *observed* rather than derived.
 *
 * **The declared half is the consumer's, and arrives as data.** `defineSchema()`
 * lives in the target system's `src/`, so the system publishes its field sets as
 * a build artifact and this reads it — the shape the link manifest already uses
 * for addresses, rather than reaching into a sibling checkout.
 *
 * **Pinned to the declared version, never the system's `main`.** This is the
 * whole of the kethira case: `subType` *is* defined on sohl `main` and simply
 * has not been released, while the module declares `verified: 0.8.2`. A check
 * run against `main` passes and the field still evaporates for every user, so
 * the comparison is against the schema of the declared
 * `compatibility.verified`.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { cachedSchemaPath, SCHEMA_ARTIFACT_FILE } from "./foreign-catalog.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { systemData, systemDataPaths, undeclaredPaths } from "./system-block.mjs";

/**
 * The artifact version this module reads.
 *
 * A mismatch stops the check rather than resolving anyway: a schema read under
 * the wrong shape would report confident nonsense in both directions, and a
 * silently skipped check is the state #60 exists to leave.
 *
 * @type {number}
 */
export const SCHEMA_ARTIFACT_VERSION = 1;

/**
 * A system's published field sets.
 *
 * @typedef {object} SchemaArtifact
 * @property {number} version - {@link SCHEMA_ARTIFACT_VERSION}.
 * @property {string} system - The system id the schemas belong to.
 * @property {string} systemVersion - The system version they were read from.
 * @property {Record<string, Record<string, {own: string[], inherited: string[]}>>} documents
 *   Document type → subtype → its field paths, dotted for nested schema fields.
 */

/**
 * Why `own` and `inherited` are recorded apart.
 *
 * A subtype's schema spreads its parent's — `MysticalAbilityDataModel` spreads
 * `SohlItemDataModel`, which spreads the common one — so `notes`, `docHtml` and
 * the rest arrive on every subtype. Those are the system's own runtime
 * concerns, filled by the system rather than by a content builder, and a
 * builder is not expected to emit them.
 *
 * Collapsing the two sets would make the *declared, not emitted* direction
 * report every inherited field on every type: a wall of findings that are all
 * correct and none actionable, which is the shape of report people learn to
 * skip. So the two directions read different sets:
 *
 * | direction | read against | severity |
 * | --- | --- | --- |
 * | emitted, not declared | `own` ∪ `inherited` — the field must exist *somewhere* | error |
 * | declared, not emitted | `own` only — what this subtype adds is what its builder answers for | report |
 *
 * @param {SchemaArtifact} artifact - The published schemas.
 * @param {string} documentType - `Item`, `Actor`, …
 * @param {string} subtype - The document subtype.
 * @returns {{own: Set<string>, all: Set<string>}|null} The sets, or `null` when
 *   the artifact declares no such subtype.
 */
export function declaredFields(artifact, documentType, subtype) {
    const entry = artifact?.documents?.[documentType]?.[subtype];
    if (!entry) return null;
    const own = new Set(entry.own ?? []);
    const all = new Set([...own, ...(entry.inherited ?? [])]);
    return { own, all };
}

/**
 * Every `system` path a field declaration can emit.
 *
 * `buildFromFields` writes each field at its `to`, so the declaration is the
 * emitted key set. A nested `to` (`charges.value`) is recorded whole, and its
 * parents are recorded too: a schema declares `charges` as a `SchemaField` and
 * the path beneath it separately, so a comparison that knew only the leaf would
 * report the container as unemitted and the leaf as undeclared.
 *
 * @param {readonly {to: string}[]} fields - A type's field declaration.
 * @returns {Set<string>} The paths, parents included.
 */
export function emittedFields(fields) {
    const out = new Set();
    for (const field of fields ?? []) {
        if (typeof field?.to !== "string" || !field.to) continue;
        const parts = field.to.split(".");
        for (let i = 1; i <= parts.length; i++) {
            out.add(parts.slice(0, i).join("."));
        }
    }
    return out;
}

/**
 * Whether a declared path is written by a field the builder already emits.
 *
 * The emitted set records a path's parents ({@link emittedFields}), so the
 * *undeclared* direction needs no such walk — `charges.value` emitted implies
 * `charges` emitted. The reverse is not symmetric: a builder may write a whole
 * object at `charges` and never name the leaves the schema declares beneath it,
 * and those leaves are populated all the same.
 *
 * @param {string} path - A declared field path.
 * @param {ReadonlySet<string>} emitted - What the builder writes.
 * @returns {boolean} Whether the path, or any ancestor of it, is written.
 */
function coveredByAncestor(path, emitted) {
    const parts = path.split(".");
    for (let i = parts.length; i >= 1; i--) {
        if (emitted.has(parts.slice(0, i).join("."))) return true;
    }
    return false;
}

/**
 * Compare one system's builders against one system's published schemas.
 *
 * Pure: field declarations in, findings out. The caller supplies both halves so
 * that a system checking itself and a module checking against a vendored
 * artifact run the identical comparison.
 *
 * @param {object} opts
 * @param {Record<string, readonly {to: string}[]>} opts.builders - Type →
 *   field declaration, as `ITEM_FIELDS` holds it.
 * @param {SchemaArtifact} opts.artifact - The receiving system's schemas.
 * @param {string} [opts.documentType="Item"] - Which document type the builders
 *   compile into.
 * @param {(type: string) => string} [opts.subtypeOf] - Maps a builder's type to
 *   the document subtype it emits. Defaults to identity, which is what the
 *   coincidence of names amounts to today (#79) — stated as a seam so that the
 *   explicit map replaces a default rather than a hard-coded assumption.
 * @returns {{undeclared: object[], unemitted: object[], skipped: string[]}}
 *   `undeclared` fails a build; `unemitted` is reported; `skipped` names the
 *   types the artifact says nothing about.
 */
export function compareFields({
    builders,
    artifact,
    documentType = "Item",
    subtypeOf = (type) => type,
}) {
    if (artifact?.version !== SCHEMA_ARTIFACT_VERSION) {
        throw new Error(
            `package-build: schema artifact version ${artifact?.version ?? "(absent)"}, ` +
                `expected ${SCHEMA_ARTIFACT_VERSION}. A schema read under the wrong ` +
                `shape would report confidently in both directions, so the check ` +
                `stops rather than resolving anyway.`,
        );
    }

    const undeclared = [];
    const unemitted = [];
    const skipped = [];

    for (const [type, fields] of Object.entries(builders ?? {})) {
        const subtype = subtypeOf(type);
        const declared = declaredFields(artifact, documentType, subtype);
        if (!declared) {
            // Not a finding: a builder may compile into a type this system does
            // not define at all, which is a routing question (#79) rather than a
            // field one. Named so the count is never mistaken for coverage.
            skipped.push(type);
            continue;
        }

        const emitted = emittedFields(fields);
        for (const path of emitted) {
            if (declared.all.has(path)) continue;
            undeclared.push({
                type,
                subtype,
                documentType,
                field: path,
                systemVersion: artifact.systemVersion,
            });
        }
        for (const path of declared.own) {
            // A builder that writes a whole object writes everything beneath
            // it: `charges` emitted covers the schema's `charges.value` and
            // `charges.max`. Checking the leaf alone reported both as unwritten
            // on a type that populates them correctly — two findings, both
            // false, on the first real schema this was run against.
            if (coveredByAncestor(path, emitted)) continue;
            unemitted.push({
                type,
                subtype,
                documentType,
                field: path,
                systemVersion: artifact.systemVersion,
            });
        }
    }

    return { undeclared, unemitted, skipped };
}

/**
 * One `system` key a compiled document carries that its subtype does not
 * declare.
 *
 * @typedef {object} EmissionFinding
 * @property {string} type - The content type whose note produced the document.
 * @property {string} subtype - The document subtype it compiled into.
 * @property {string} documentType - `Item`, `Actor`, …
 * @property {string} field - The undeclared path, dotted.
 * @property {string} systemVersion - The version checked against.
 * @property {"builder"|"compiler"} origin - What wrote it. See
 *   {@link emittedUndeclaredMessage}.
 */

/**
 * Whether a value is a mapping this walk descends into. Arrays are leaves: a
 * schema declares an `ArrayField` as one path and says nothing about its
 * indices.
 *
 * @param {unknown} value - The emitted value.
 * @returns {boolean} Whether to walk into it.
 */
function isMapping(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Every declared path that has at least one declared path beneath it.
 *
 * The artifact does not describe every subtree it declares. A discriminated
 * `TypedSchemaField` — SoHL's `strikeMode` — is published as the single path
 * `strikeMode`, because its sub-schema is chosen by a discriminator at runtime
 * and there is no one field list to publish; the compiled document stores it
 * flat as `{ type, name, … }` all the same. Walking into it against a schema
 * that says nothing about its contents reported all ten of a combat technique's
 * stored keys as undeclared — ten findings, every one wrong, about a document
 * that is correct.
 *
 * So a container is descended into only where the artifact actually enumerates
 * something beneath it. That is the same stance {@link declaredFields} takes on
 * a subtype the artifact does not name: what is not described is not checked,
 * rather than guessed at.
 *
 * @param {ReadonlySet<string>} declared - Every path the subtype declares.
 * @returns {Set<string>} The paths whose subtree the artifact describes.
 */
function enumeratedContainers(declared) {
    const out = new Set();
    for (const declaredPath of declared) {
        const parts = declaredPath.split(".");
        for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join("."));
    }
    return out;
}

/**
 * The paths in a compiled `system` block that the subtype does not declare.
 *
 * {@link module:engine/system-block.undeclaredPaths} answers this for *authored*
 * data, where every path came from a human and every container is one a human
 * typed. An emitted block is different in one way that matters: it contains
 * whole subtrees the artifact declares as a single path and describes no
 * further — see {@link enumeratedContainers} — so the walk stops there instead
 * of reporting their contents.
 *
 * Reported at the shallowest undeclared path, as its sibling is: everything
 * beneath an undeclared container is undeclared by construction, and listing it
 * all buries the one key that is the problem.
 *
 * @param {Record<string, unknown>} data - The emitted `system` block.
 * @param {ReadonlySet<string>} declared - Every path the subtype declares.
 * @param {ReadonlySet<string>} enumerated - From {@link enumeratedContainers}.
 * @param {string} [prefix] - Internal: the path so far.
 * @returns {string[]} The undeclared paths, shallowest-first.
 */
function undeclaredEmittedPaths(data, declared, enumerated, prefix = "") {
    const out = [];
    if (!isMapping(data)) return out;
    for (const [key, value] of Object.entries(data)) {
        const emittedPath = prefix ? `${prefix}.${key}` : key;
        if (!declared.has(emittedPath)) {
            out.push(emittedPath);
            continue;
        }
        if (!isMapping(value) || !Object.keys(value).length) continue;
        if (!enumerated.has(emittedPath)) continue;
        out.push(
            ...undeclaredEmittedPaths(
                /** @type {Record<string, unknown>} */ (value),
                declared,
                enumerated,
                emittedPath,
            ),
        );
    }
    return out;
}

/**
 * What a **compiled document** carries in `system`, against what the receiving
 * subtype declares (#155).
 *
 * The third of the three checks, and the only one whose emitted set is
 * *observed*. {@link compareFields} reads the `itemBuilders` declarations and
 * {@link checkAuthoredSystemData} reads a note's `<system>.system`; between them
 * they miss every key a compiler writes on its own initiative, which is not a
 * residue — it is `shortcode`, `actionDefs`, `notes`, `docHtml` and `archetype`.
 *
 * **The keys come from the object the compiler built, after a JSON round trip.**
 * That is exactly what the pack file receives, so a key whose value is
 * `undefined` — dropped by `JSON.stringify`, never written, nothing for Foundry
 * to discard — is correctly not a finding. Reading the assembled block is also
 * the only derivation that cannot go stale: a compiler that grows a key is
 * checked on the next build without anyone remembering to add it to a list.
 *
 * **Authored paths are left alone.** A note's own `<system>.system` is reported
 * by {@link checkAuthoredSystemData}, which can point at the line the author
 * wrote; reporting it again here would be the same defect twice, once without a
 * position.
 *
 * **A subtree the artifact does not describe is not checked**, rather than
 * reported wholesale — see {@link enumeratedContainers} for the
 * `TypedSchemaField` case that makes the distinction load-bearing.
 *
 * @param {object} opts
 * @param {object} opts.system - The `system` block the compiler assembled.
 * @param {SchemaArtifact} opts.artifact - The receiving system's schemas.
 * @param {string} opts.documentType - `Item`, `Actor`, …
 * @param {string} opts.subtype - The document subtype being emitted.
 * @param {string} opts.type - The content type whose note produced it, for the
 *   message.
 * @param {readonly {to?: string}[]} [opts.fields] - The type's field
 *   declaration, which decides a finding's {@link EmissionFinding.origin}.
 * @param {ReadonlySet<string>} [opts.authored] - Paths the note authored, left
 *   to the note-side check.
 * @returns {EmissionFinding[]} One per undeclared path, shallowest-first.
 */
export function compareEmittedSystem({
    system,
    artifact,
    documentType,
    subtype,
    type,
    fields,
    authored = new Set(),
}) {
    if (artifact?.version !== SCHEMA_ARTIFACT_VERSION) {
        throw new Error(
            `package-build: schema artifact version ${artifact?.version ?? "(absent)"}, ` +
                `expected ${SCHEMA_ARTIFACT_VERSION}. A schema read under the wrong ` +
                `shape would report confidently in both directions, so the check ` +
                `stops rather than resolving anyway.`,
        );
    }

    const declared = declaredFields(artifact, documentType, subtype);
    // Not a finding, for the same reason `compareFields` skips one: a subtype
    // the artifact says nothing about is a routing question (#79), not a field
    // one, and guessing at it would report every key on the document.
    if (!declared) return [];

    // What the pack file receives. `undefined` is gone after this, which is the
    // point: a key that never reaches the JSON is not an emitted key.
    const emitted = JSON.parse(JSON.stringify(system ?? {}));
    const byField = emittedFields(fields ?? []);

    return undeclaredEmittedPaths(emitted, declared.all, enumeratedContainers(declared.all))
        .filter((field) => !authored.has(field))
        .map((field) => ({
            type,
            subtype,
            documentType,
            field,
            systemVersion: artifact.systemVersion,
            origin: /** @type {"builder"|"compiler"} */ (
                byField.has(field) ? "builder" : "compiler"
            ),
        }));
}

/**
 * The published schema this build should check itself against, or `null`.
 *
 * **Which system, and which version, are already settled.** `stats.systemId`
 * and `stats.systemVersion` are derived rather than authored (#48) — a system
 * package is its own system, and a module takes the one it requires — and the
 * version is the `compatibility.verified` it pins. So the question "whose
 * schema, at what version" has one answer here rather than a second set of
 * configuration to disagree with the first.
 *
 * Two places to find it, because a system checks itself against source it owns
 * while a module checks against a dependency it fetched:
 *
 * - **A system**: its own `schema.json`, generated from its `src/` and
 *   committed beside it.
 * - **A module**: the copy cached by `content-build deps fetch`, from the
 *   archive of the version it pins — which is what makes the comparison happen
 *   at `verified` rather than against whatever the system's `main` holds today.
 *   That distinction is the whole of the `affiliation.subType` case.
 *
 * `null` where there is nothing to check against: a system-agnostic module
 * stamps no system at all, and a system that has not adopted the artifact yet
 * is simply unchecked. Neither is an error, and the caller says which it was.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {{artifact: SchemaArtifact, source: string}|null} The schema and
 *   where it was read from.
 */
export function resolveSchemaArtifact(config) {
    const systemId = config?.stats?.systemId;
    if (!systemId) return null;

    const read = (file) => ({
        artifact: JSON.parse(fs.readFileSync(file, "utf8")),
        source: file,
    });

    // The system checking itself, against the schema its own build published.
    if (config.packageKind === "systems" && config.foundryPackage === systemId) {
        const own = path.join(config.rootDir, SCHEMA_ARTIFACT_FILE);
        return fs.existsSync(own) ? read(own) : null;
    }

    const version = config?.stats?.systemVersion;
    if (!version) return null;
    const cached = cachedSchemaPath(config, systemId, version);
    return fs.existsSync(cached) ? read(cached) : null;
}

/**
 * What an author is told about a field the target system does not define.
 *
 * Names the version, because the same field may be perfectly well defined on
 * the system's `main` and simply unreleased — which is exactly the kethira case,
 * and the difference between "you typed it wrong" and "you are ahead of your
 * pin".
 *
 * @param {object} finding - One entry from `undeclared`.
 * @returns {string} The message.
 */
export function undeclaredMessage(finding) {
    return (
        `\`${finding.type}\` emits \`system.${finding.field}\`, which ` +
        `${finding.documentType} subtype "${finding.subtype}" does not define at ` +
        `${finding.systemVersion} — Foundry discards an unknown \`system\` key ` +
        `when the document is constructed, without a warning, so the value is ` +
        `lost at load while the build reports success`
    );
}

/**
 * What an author is told about a declared field no builder writes.
 *
 * Advisory rather than fatal: a field the system fills at runtime, or one added
 * ahead of the content that will use it, is not a defect. Only fields the
 * subtype declares *itself* are reported — see {@link declaredFields}.
 *
 * @param {object} finding - One entry from `unemitted`.
 * @returns {string} The message.
 */
export function unemittedMessage(finding) {
    return (
        `${finding.documentType} subtype "${finding.subtype}" declares ` +
        `\`system.${finding.field}\` at ${finding.systemVersion}, which ` +
        `\`${finding.type}\` never emits — every compiled document will carry the ` +
        `field's initial value rather than an authored one`
    );
}

/**
 * What an author is told about an emitted key the target system does not
 * define — in the terms of whoever can actually fix it.
 *
 * The failure is identical in both cases and the remedies are not, which is
 * why the two are told apart at all:
 *
 * | origin | who writes it | what fixes it |
 * | --- | --- | --- |
 * | `builder` | a `fields:` entry in this repository's `itemBuilders` | change the field's `to`, or get the system to declare it |
 * | `compiler` | this package, on every document of the subtype | **nothing here** — the system must declare it, or this package must be pinned to a build that does not write it |
 *
 * A `compiler` finding is the one worth spelling out, because the obvious first
 * move — go and look for the field in `itemBuilders` — leads nowhere: there is
 * no declaration to correct. It means the build is running ahead of the system
 * it compiles for, and the version named in the message is what says so.
 *
 * @param {EmissionFinding} finding - One entry from
 *   {@link compareEmittedSystem}.
 * @returns {string} The message.
 */
export function emittedUndeclaredMessage(finding) {
    if (finding.origin === "builder") return undeclaredMessage(finding);
    return (
        `the compiler writes \`system.${finding.field}\` into every ` +
        `${finding.documentType} of subtype "${finding.subtype}", and no field ` +
        `declaration names it — ${finding.documentType} subtype ` +
        `"${finding.subtype}" does not define it at ${finding.systemVersion}, and ` +
        `Foundry discards an unknown \`system\` key when the document is ` +
        `constructed, without a warning, so the value is lost at load while the ` +
        `build reports success. No \`itemBuilders\` change fixes this: declare ` +
        `the field in the receiving system, or hold this package at a build that ` +
        `does not write it`
    );
}

/** One resolved schema artifact per resolved configuration. */
const artifacts = new WeakMap();

/**
 * {@link resolveSchemaArtifact}, read once per configuration.
 *
 * The per-note check below runs thousands of times in a build and the artifact
 * never changes inside one, so reading and parsing it per note would be a
 * megabyte of JSON per hundred documents for an answer that is already known.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {{artifact: SchemaArtifact, source: string}|null} The schema.
 */
function schemaFor(config) {
    if (!artifacts.has(config)) artifacts.set(config, resolveSchemaArtifact(config));
    return artifacts.get(config);
}

/**
 * What a note authors under `<system>.system`, against what the receiving
 * subtype declares (#58).
 *
 * The **note-side** half of the check `compareFields` performs on the
 * declarations. A field list is checked once for the whole build because it is
 * the same for every document; an authored `system` block is a property of one
 * note, so it is checked where that note is compiled and reported against that
 * note's file.
 *
 * It is the same failure either way, and the reason both halves exist: Foundry
 * discards an unknown `system` key at construction and says nothing, so a
 * mistyped path is lost at load while the build reports success.
 *
 * **Silent where there is nothing to check against.** A module pinning a system
 * version released before the artifact existed, or a subtype the artifact does
 * not name, produces no findings — the same stance `compareFields` takes, where
 * an unknown subtype is a routing question rather than a field one. The
 * whole-build check in `content-build lint` is where a missing artifact is said
 * out loud, once, instead of per note.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} opts
 * @param {string} opts.block - The system block to read, e.g. `"sohl"`.
 * @param {string} opts.documentType - `Item`, `Actor`, …
 * @param {string} opts.subType - The document subtype the note compiles into.
 * @param {object} [opts.config] - The resolved build configuration.
 * @returns {{path: string, message: string}[]} One finding per undeclared path,
 *   shallowest-first.
 */
export function checkAuthoredSystemData(
    fm,
    { block, documentType, subType, config = loadPackConfig() },
) {
    const data = systemData(fm, block);
    if (!Object.keys(data).length) return [];

    const schema = schemaFor(config);
    if (!schema) return [];
    const declared = declaredFields(schema.artifact, documentType, subType);
    if (!declared) return [];

    return undeclaredPaths(data, declared.all).map((path) => ({
        path,
        message:
            `\`${block}.system.${path}\` is not a field ${documentType} subtype ` +
            `"${subType}" declares at ${schema.artifact.systemVersion} — Foundry ` +
            `discards an unknown \`system\` key when the document is constructed, ` +
            `without a warning, so the value is lost at load while the build ` +
            `reports success`,
    }));
}

/**
 * The `system` block a compiler just assembled, against what the receiving
 * subtype declares (#155).
 *
 * The build-time face of {@link compareEmittedSystem}: it resolves the schema
 * the way every other check here does — the system's own committed artifact, or
 * the cached one from the release a module pins — and attaches the message a
 * reader sees.
 *
 * **Silent where there is nothing to check against**, exactly as its two
 * siblings are: a module pinning a system version released before the artifact
 * existed, or a subtype the artifact does not name, produces no findings.
 * `content-build lint` is where a missing artifact is said out loud, once.
 *
 * @param {object} system - The `system` block the compiler produced.
 * @param {object} opts
 * @param {object} opts.fm - The note's frontmatter, for the authored paths this
 *   check leaves to {@link checkAuthoredSystemData}.
 * @param {string} opts.block - The system block to read, e.g. `"sohl"`.
 * @param {string} opts.documentType - `Item`, `Actor`, …
 * @param {string} opts.subType - The document subtype the note compiles into.
 * @param {string} opts.type - The note's content type, for the message.
 * @param {readonly {to?: string}[]} [opts.fields] - The type's field
 *   declaration, which decides each finding's origin.
 * @param {object} [opts.config] - The resolved build configuration.
 * @returns {(EmissionFinding & {message: string})[]} One per undeclared path.
 */
export function checkEmittedSystemData(
    system,
    { fm, block, documentType, subType, type, fields, config = loadPackConfig() },
) {
    const schema = schemaFor(config);
    if (!schema) return [];

    return compareEmittedSystem({
        system,
        artifact: schema.artifact,
        documentType,
        subtype: subType,
        type,
        fields,
        authored: new Set(systemDataPaths(systemData(fm, block))),
    }).map((finding) => ({ ...finding, message: emittedUndeclaredMessage(finding) }));
}
