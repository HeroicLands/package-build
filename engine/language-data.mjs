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
 * What a language note's register, tongues, scope, sounds and cognates mean,
 * beyond their shape.
 *
 * The inner-key check holds every entry to its declared keys, kinds and closed
 * lists. This check owns the rest, each finding located at the key at fault:
 *
 * - no skill of another subType states these keys;
 * - a tongue tag is lowercase letters and digits, optionally closing on
 *   `:<tongue>`, and stands once; a tongue's `language` names a language note;
 * - every tag a register row or a letter row names is declared in
 *   `data.tongues`, `translation` apart: `exonym:vylari` is declared by
 *   `exonym:<tongue>`;
 * - an edge stands once in `data.sounds.edges`;
 * - every Address in `data.scope` resolves, and every type it names is a note
 *   type;
 * - every language a cognate's `forms` names is a language note;
 * - a register row states a `tongue` or a `kind`;
 * - a sound-change set's name stands once in the note, a step's label once
 *   in its set, and its `from` and `to` name language notes;
 * - a frame's classes are bases of the master word classes;
 * - a calling-name closing states a `form` or `doubled: true`, not both.
 *
 * @module
 */

import { pathLabel as label } from "./data-keys.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { addressKeyOf } from "./culture-reach.mjs";
import { AddressEntries } from "./address-values.mjs";
import { isAddressTuple, renderAddress } from "./address.mjs";
import {
    LANGUAGE_DATA_KEYS,
    RESERVED_TONGUE,
    SCOPE_KINDS,
    TONGUE_PLACEHOLDER,
} from "./language-terms.mjs";
import { LANGUAGE_SUBTYPE } from "./word-terms.mjs";
import { WORD_CLASS_BASES } from "./word-classes.mjs";

/** The bases a frame's `class` names. */
const CLASS_BASES = new Set(WORD_CLASS_BASES.map((item) => item.token));

/** Whether a value is a plain map. */
const isMap = (value) =>
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isAddressTuple(value) &&
    !(value instanceof AddressEntries);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/** The shape of a declared tongue tag. */
const TAG_PATTERN = new RegExp(`^[a-z][a-z0-9]*(?::${TONGUE_PLACEHOLDER})?$`);

/** The shape of a tongue tag a row names: a tag, or a tag and a tongue. */
const USED_TAG_PATTERN = /^([a-z][a-z0-9]*)(?::([a-z][a-z0-9]*))?$/;

/** The type a bare shortcode in each scope list defaults to. */
const SCOPE_DEFAULT_TYPES = Object.freeze({
    folders: "folder",
    cultures: "lore",
    lore: "lore",
    parents: "place",
});

/**
 * Whether a tag a row names is one `data.tongues` declares.
 *
 * @param {string} tag - The tag as the row writes it.
 * @param {Set<string>} declared - The declared tags.
 * @returns {boolean}
 */
export function tongueDeclared(tag, declared) {
    if (tag === RESERVED_TONGUE) return true;
    const match = USED_TAG_PATTERN.exec(tag);
    if (!match) return false;
    return match[2] === undefined ?
            declared.has(tag)
        :   declared.has(`${match[1]}:${TONGUE_PLACEHOLDER}`);
}

/**
 * The entries of a cognate's `forms`, whatever form it reached the check in:
 * `[written key, value, Address]`.
 *
 * @param {unknown} forms - The `forms` value.
 * @returns {Array<[string, unknown, unknown]>}
 */
function formEntries(forms) {
    if (forms instanceof AddressEntries)
        return forms.entries.map((entry) => [entry.sourceKey, entry.value, entry.target]);
    if (isMap(forms)) return Object.entries(forms).map(([key, value]) => [key, value, key]);
    return [];
}

/**
 * Check a `skill` note's language data against what it means.
 *
 * @param {object} note - A `skill` note: `file`, `raw` and parsed `fm`.
 * @param {object} [context]
 * @param {object} [context.index] - The index, for whether an Address
 *   resolves. Without one, only what the note says of itself is checked.
 * @param {readonly string[]} [context.types] - The note types a scope may name.
 * @returns {object[]} The findings.
 */
export function checkLanguageData(note, { index, types } = {}) {
    const fm = note?.fm ?? {};
    const data = isMap(fm.data) ? fm.data : {};
    const raw = note.raw ?? "";
    const finding = (path, severity, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, path, { key }),
        severity,
        message,
    });
    const stated = (key) => data[key] !== undefined && data[key] !== null;

    if (String(fm.subType ?? "").toLowerCase() !== LANGUAGE_SUBTYPE)
        return LANGUAGE_DATA_KEYS.filter(stated).map((key) =>
            finding(
                ["data", key],
                "error",
                `\`data.${key}\` describes a language, and this note's \`subType\` is not ` +
                    `\`${LANGUAGE_SUBTYPE}\``,
                true,
            ),
        );

    const findings = [];

    /**
     * The note an Address names, or a finding where it names none.
     *
     * @param {unknown} value - The Address as the note holds it.
     * @param {Array<string|number>} path - Where it sits.
     * @param {string|undefined} type - The type a bare shortcode defaults to.
     * @param {boolean} [key] - Whether the Address is a map key.
     * @returns {{target?: object, key?: string, finding?: object}}
     */
    function resolve(value, path, type, key = false) {
        if (!index?.addressHit || value === undefined || value === null) return {};
        const canonical = addressKeyOf(value, index, type);
        if (!canonical)
            return {
                finding: finding(
                    path,
                    "error",
                    `\`${label(path)}\` is not an Address: ${JSON.stringify(
                        isAddressTuple(value) ? renderAddress(value) : value,
                    )}`,
                    key,
                ),
            };
        const target = index.addressHit(canonical);
        if (!target)
            return {
                finding: finding(
                    path,
                    "error",
                    `\`${label(path)}\` names ${canonical}, which does not resolve in this ` +
                        "package or its declared dependencies",
                    key,
                ),
            };
        return { target, key: canonical };
    }

    /** As {@link resolve}, and the target must be a language note. */
    function language(value, path, key = false) {
        const result = resolve(value, path, "skill", key);
        if (result.finding) return [result.finding];
        if (!result.target) return [];
        const target = result.target.fm ?? result.target;
        if (target.type === "skill" && target.subType === LANGUAGE_SUBTYPE) return [];
        return [
            finding(
                path,
                "error",
                `\`${label(path)}\` names ${result.key}, which is not a skill whose subType is ` +
                    "language",
                key,
            ),
        ];
    }

    // ── Tongues ──────────────────────────────────────────────────────────────
    const declared = new Set();
    const tagAt = new Map();
    listOf(data.tongues).forEach((tongue, i) => {
        if (!isMap(tongue)) return;
        const at = (key) => ["data", "tongues", i, key];
        if (typeof tongue.tag === "string") {
            if (!TAG_PATTERN.test(tongue.tag))
                findings.push(
                    finding(
                        at("tag"),
                        "error",
                        `the tag \`${tongue.tag}\` is not lowercase letters and digits, optionally ` +
                            `closing on \`:${TONGUE_PLACEHOLDER}\``,
                    ),
                );
            else if (tagAt.has(tongue.tag))
                findings.push(
                    finding(
                        at("tag"),
                        "error",
                        `the tag \`${tongue.tag}\` stands twice, first at ` +
                            `\`data.tongues[${tagAt.get(tongue.tag)}]\``,
                    ),
                );
            else {
                tagAt.set(tongue.tag, i);
                declared.add(tongue.tag);
            }
        }
        findings.push(...language(tongue.language, at("language")));
    });

    /**
     * A finding for each tag a row names that `data.tongues` does not declare.
     *
     * @param {unknown[]} tags - The tags the row names.
     * @param {(j: number) => Array<string|number>} pathOf - Where the `j`th sits.
     */
    const undeclared = (tags, pathOf) => {
        tags.forEach((tag, j) => {
            if (typeof tag !== "string" || tongueDeclared(tag, declared)) return;
            findings.push(
                finding(
                    pathOf(j),
                    "error",
                    `the tongue \`${tag}\` is not declared in \`data.tongues\``,
                ),
            );
        });
    };
    listOf(data.register).forEach((row, i) => {
        if (!isMap(row)) return;
        if (row.tongue == null && row.kind == null)
            findings.push(
                finding(
                    ["data", "register", i],
                    "error",
                    `\`data.register[${i}]\` states neither a \`tongue\` nor a \`kind\``,
                ),
            );
        if (typeof row.tongue !== "string") return;
        undeclared([row.tongue], () => ["data", "register", i, "tongue"]);
    });

    // ── Sounds ───────────────────────────────────────────────────────────────
    const sounds = isMap(data.sounds) ? data.sounds : {};
    listOf(sounds.letters).forEach((row, i) => {
        if (!isMap(row) || row.tongue === undefined || row.tongue === null) return;
        const path = ["data", "sounds", "letters", i, "tongue"];
        if (Array.isArray(row.tongue)) undeclared(row.tongue, (j) => [...path, j]);
        else undeclared([row.tongue], () => path);
    });
    const edgeAt = new Map();
    listOf(sounds.edges).forEach((row, i) => {
        if (!isMap(row) || typeof row.edge !== "string") return;
        if (edgeAt.has(row.edge))
            findings.push(
                finding(
                    ["data", "sounds", "edges", i, "edge"],
                    "error",
                    `the edge \`${row.edge}\` stands twice, first at ` +
                        `\`data.sounds.edges[${edgeAt.get(row.edge)}]\``,
                ),
            );
        else edgeAt.set(row.edge, i);
    });

    listOf(sounds.frames).forEach((row, i) => {
        if (!isMap(row)) return;
        listOf(row.class).forEach((base, j) => {
            if (typeof base !== "string" || CLASS_BASES.has(base)) return;
            findings.push(
                finding(
                    ["data", "sounds", "frames", i, "class", j],
                    "error",
                    `\`${base}\` is not a base of the master word classes`,
                ),
            );
        });
    });

    // ── Sound changes ────────────────────────────────────────────────────────
    const setAt = new Map();
    listOf(data.soundChanges).forEach((set, i) => {
        if (!isMap(set)) return;
        const at = (...rest) => ["data", "soundChanges", i, ...rest];
        if (typeof set.name === "string") {
            if (setAt.has(set.name))
                findings.push(
                    finding(
                        at("name"),
                        "error",
                        `the set \`${set.name}\` stands twice, first at \`data.soundChanges[${setAt.get(set.name)}]\``,
                    ),
                );
            else setAt.set(set.name, i);
        }
        findings.push(...language(set.from, at("from")), ...language(set.to, at("to")));
        const stepAt = new Map();
        listOf(set.steps).forEach((step, j) => {
            if (!isMap(step) || typeof step.step !== "string") return;
            if (stepAt.has(step.step))
                findings.push(
                    finding(
                        at("steps", j, "step"),
                        "error",
                        `the step \`${step.step}\` stands twice in its set, first at ` +
                            `\`data.soundChanges[${i}].steps[${stepAt.get(step.step)}]\``,
                    ),
                );
            else stepAt.set(step.step, j);
        });
    });

    // ── Calling names ────────────────────────────────────────────────────────
    const calling = isMap(data.callingNames) ? data.callingNames : {};
    listOf(calling.closings).forEach((row, i) => {
        if (!isMap(row)) return;
        const form = row.form != null;
        const doubled = row.doubled === true;
        if (form === doubled)
            findings.push(
                finding(
                    ["data", "callingNames", "closings", i],
                    "error",
                    `\`data.callingNames.closings[${i}]\` states ${form ? "both" : "neither"} a ` +
                        "`form` and `doubled: true`; it states one",
                ),
            );
    });

    // ── Scope ────────────────────────────────────────────────────────────────
    const scope = isMap(data.scope) ? data.scope : {};
    for (const kind of SCOPE_KINDS) {
        listOf(scope[kind]).forEach((value, i) => {
            const path = ["data", "scope", kind, i];
            if (kind === "paths") return;
            if (kind === "types") {
                if (types && typeof value === "string" && !types.includes(value))
                    findings.push(finding(path, "error", `\`${value}\` is not a note type`));
                return;
            }
            const result = resolve(value, path, SCOPE_DEFAULT_TYPES[kind]);
            if (result.finding) findings.push(result.finding);
        });
    }

    // ── Cognates ─────────────────────────────────────────────────────────────
    listOf(data.cognates).forEach((row, i) => {
        if (!isMap(row)) return;
        for (const [written, , target] of formEntries(row.forms))
            findings.push(...language(target, ["data", "cognates", i, "forms", written], true));
    });

    return findings;
}
