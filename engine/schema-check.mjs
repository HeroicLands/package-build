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
 * **The emitted half needs no compilation and no parsing.** A builder *is* its
 * field list — {@link module:engine/field-spec} makes `buildFromFields` the only
 * statement of the mapping — so every `system` path a type can emit is
 * `field.to`, known statically. Nothing here compiles a document to find out.
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
    if (
        config.packageKind === "systems" &&
        config.foundryPackage === systemId
    ) {
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
