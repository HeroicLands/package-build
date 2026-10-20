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
 * - a sound stands once in each mutation of `data.sounds.mutations`;
 * - a cluster stands in one group of `data.sounds.clusters.groups`, and a
 *   language stating groups states no `innerCluster` edge;
 * - every vowel `data.sounds.syllables.harmony.partners` keys is a vowel of
 *   the harmony, and every partner one of its `front` vowels;
 * - every Address in `data.scope` resolves, and every type it names is a note
 *   type;
 * - every language a cognate's `forms` names is a language note;
 * - a register row states a `tongue` or a `kind`;
 * - a register row tagged `other:<tongue>` or `exonym:<tongue>` names a name
 *   the tongue's own language note registers under that tongue, case folded
 *   and NFC (see {@link foreignRowFindings});
 * - a sound-change set's name stands once in the note, a step's label once
 *   in its set, and its `from` and `to` name language notes;
 * - a frame's classes are bases of the master word classes;
 * - a calling-name closing states a `form` or `doubled: true`, not both;
 * - a form stands once in `data.older`;
 * - the mutation `data.negation` names is one of `data.sounds.mutations`;
 * - in `data.naming`, a class of name has one shape, which states its
 *   syllables, its consonants per vowel or both, each range's `min` no
 *   higher than its `max`; an edge stands once for each class of name; a kind
 *   of name has one set of draws; and a held-from row takes `elements` only
 *   where it takes an `element`, and is clipped or given a joining ending only
 *   where it takes a name.
 *
 * @module
 */

import { pathLabel as label } from "./data-keys.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { addressKeyOf, isLanguageNote } from "./culture-reach.mjs";
import { AddressEntries } from "./address-values.mjs";
import { isAddressTuple, renderAddress } from "./address.mjs";
import {
    ANY_NAME,
    HELD_NAMES,
    HELD_TAKES,
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

/** The tag families whose rows name a name of another tongue's register. */
const FOREIGN_FAMILIES = new Set(["other", "exonym"]);

/** How a foreign row that its tongue's register does not bear out is reported. */
export const FOREIGN_ROW_SEVERITY = "warning";

/** A name as a foreign row is compared: NFC and lowercase. */
const foldName = (name) => name.normalize("NFC").toLowerCase();

/**
 * Each tag a language note of the index declares with a `language`, to the
 * canonical Addresses of the language notes it names, keyed once per index.
 *
 * @type {WeakMap<object, Map<string, Set<string>>>}
 */
const tongueLanguagesByIndex = new WeakMap();

/**
 * The language notes each tag names: every `data.tongues` entry of the index's
 * own language notes whose `tag` is a plain tag and that states a `language`.
 *
 * @param {object} index - The link index.
 * @returns {Map<string, Set<string>>} Canonical Addresses by tag.
 */
function tongueLanguages(index) {
    const known = tongueLanguagesByIndex.get(index);
    if (known) return known;
    const out = new Map();
    for (const note of index.notes ?? []) {
        if (!isLanguageNote(note.fm)) continue;
        for (const tongue of listOf(note.fm?.data?.tongues)) {
            if (!isMap(tongue) || typeof tongue.tag !== "string" || tongue.tag.includes(":"))
                continue;
            const key = addressKeyOf(tongue.language, index, "skill");
            if (!key) continue;
            if (!out.has(tongue.tag)) out.set(tongue.tag, new Set());
            out.get(tongue.tag).add(key);
        }
    }
    tongueLanguagesByIndex.set(index, out);
    return out;
}

/**
 * The findings on a register's rows tagged `other:<tongue>` or
 * `exonym:<tongue>`, each checked against the register of the tongue's own
 * language note.
 *
 * A tongue names the language note a `data.tongues` entry of one of the
 * index's language notes tags it with, through its `language`: `other:helonic`
 * reads the note that `{tag: helonic, language: skill-helonclng}` names. The
 * row passes when that note's `data.register` holds a row of the same name
 * whose `tongue` is `helonic`. A tongue no entry links to a language note, or
 * one linked to two, is a finding at the row's `tongue`; a language note of
 * another package is not read, since its register does not reach this index.
 * Bare `other`, and every other tag, are not checked.
 *
 * @param {Array<{row: object, i: number}>} rows - The register rows whose tag
 *   `data.tongues` declares.
 * @param {object|undefined} index - The link index.
 * @param {(path: Array<string|number>, severity: string, message: string) => object} finding -
 *   Builds a finding at a frontmatter path.
 * @returns {object[]} The findings.
 */
function foreignRowFindings(rows, index, finding) {
    if (!index?.addressHit) return [];
    const findings = [];
    for (const { row, i } of rows) {
        const match = USED_TAG_PATTERN.exec(row.tongue);
        if (!match || match[2] === undefined || !FOREIGN_FAMILIES.has(match[1])) continue;
        const tongue = match[2];
        const languages = [...(tongueLanguages(index).get(tongue) ?? [])];
        if (languages.length !== 1) {
            findings.push(
                finding(
                    ["data", "register", i, "tongue"],
                    FOREIGN_ROW_SEVERITY,
                    languages.length ?
                        `the tongue \`${tongue}\` in \`${row.tongue}\` names ${languages.length} ` +
                            `language notes, ${languages.join(" and ")}; the \`data.tongues\` entries ` +
                            `tagged \`${tongue}\` name one`
                    :   `the tongue \`${tongue}\` in \`${row.tongue}\` names no language note: no ` +
                            `language note's \`data.tongues\` tags \`${tongue}\` with a \`language\``,
                ),
            );
            continue;
        }
        const target = index.addressHit(languages[0]);
        const fm = target?.fm;
        if (!fm || !isLanguageNote(fm)) continue;
        const name = foldName(row.name);
        const listed = listOf(fm.data?.register).some(
            (other) =>
                isMap(other) &&
                other.tongue === tongue &&
                typeof other.name === "string" &&
                foldName(other.name) === name,
        );
        if (listed) continue;
        const title = typeof fm.name?.full === "string" ? fm.name.full : fm.name;
        findings.push(
            finding(
                ["data", "register", i, "name"],
                FOREIGN_ROW_SEVERITY,
                `\`${row.name}\` is registered as \`${row.tongue}\`, but the register of ` +
                    `${title} (${fm.type}-${fm.shortcode}) lists no \`${tongue}\` name ` +
                    `\`${row.name}\`; correct the spelling, or register the name there first`,
            ),
        );
    }
    return findings;
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

    // Only the shape of a supplied declaration: no word is compared with it.
    const grammar = isMap(data.grammar) ? data.grammar : {};
    listOf(grammar.plural).forEach((row, i) => {
        if (row == null || (Array.isArray(row) && row.length === 0))
            findings.push(
                finding(
                    ["data", "grammar", "plural", i],
                    "error",
                    `\`data.grammar.plural[${i}]\` must be a map with ending and becomes strings`,
                ),
            );
    });
    const verbs = grammar.verbs;
    if (Array.isArray(verbs) && verbs.length === 0)
        findings.push(
            finding(
                ["data", "grammar", "verbs"],
                "error",
                "`data.grammar.verbs` must state `invariant: true` or the six `persons` strings",
            ),
        );
    if (isMap(verbs)) {
        const invariant = Object.hasOwn(verbs, "invariant");
        const persons = Object.hasOwn(verbs, "persons");
        if (invariant === persons)
            findings.push(
                finding(
                    ["data", "grammar", "verbs"],
                    "error",
                    "`data.grammar.verbs` must state exactly one of `invariant: true` or `persons`",
                ),
            );
        else if (invariant && Object.hasOwn(verbs, "replaces"))
            findings.push(
                finding(
                    ["data", "grammar", "verbs", "replaces"],
                    "error",
                    "`data.grammar.verbs.replaces` states what a `persons` ending replaces, and an invariant pattern has none",
                ),
            );
        else if (typeof verbs.replaces === "string" && !verbs.replaces.trim())
            findings.push(
                finding(
                    ["data", "grammar", "verbs", "replaces"],
                    "error",
                    "`data.grammar.verbs.replaces` must name the letters an ending replaces; leave it out where endings are added",
                ),
            );
        else if (invariant && (verbs.invariant == null || verbs.invariant === false))
            findings.push(
                finding(
                    ["data", "grammar", "verbs", "invariant"],
                    "error",
                    "`data.grammar.verbs.invariant` must be true",
                ),
            );
        else if (
            persons &&
            (verbs.persons == null || (Array.isArray(verbs.persons) && verbs.persons.length === 0))
        )
            findings.push(
                finding(
                    ["data", "grammar", "verbs", "persons"],
                    "error",
                    "`data.grammar.verbs.persons` must be a map of all six ending strings",
                ),
            );
    }

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
    const foreignRows = [];
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
        if (typeof row.name === "string" && tongueDeclared(row.tongue, declared))
            foreignRows.push({ row, i });
    });
    findings.push(...foreignRowFindings(foreignRows, index, finding));

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

    if (isMap(sounds.clusters) && Array.isArray(sounds.clusters.groups))
        listOf(sounds.edges).forEach((row, i) => {
            if (!isMap(row) || row.edge !== "innerCluster") return;
            findings.push(
                finding(
                    ["data", "sounds", "edges", i, "edge"],
                    "error",
                    "`data.sounds.clusters.groups` states the clusters inside a word, so no " +
                        "`innerCluster` edge does",
                ),
            );
        });
    const clusterAt = new Map();
    listOf(sounds.clusters?.groups).forEach((group, i) => {
        if (!isMap(group)) return;
        listOf(group.clusters).forEach((cluster, j) => {
            if (typeof cluster !== "string") return;
            if (clusterAt.has(cluster))
                findings.push(
                    finding(
                        ["data", "sounds", "clusters", "groups", i, "clusters", j],
                        "error",
                        `the cluster \`${cluster}\` stands twice, first in ` +
                            `\`data.sounds.clusters.groups[${clusterAt.get(cluster)}]\``,
                    ),
                );
            else clusterAt.set(cluster, i);
        });
    });

    const mutationAt = new Map();
    listOf(sounds.mutations).forEach((row, i) => {
        if (!isMap(row) || typeof row.mutation !== "string" || typeof row.sound !== "string")
            return;
        const key = JSON.stringify([row.mutation, row.sound]);
        if (mutationAt.has(key))
            findings.push(
                finding(
                    ["data", "sounds", "mutations", i, "sound"],
                    "error",
                    `the sound \`${row.sound}\` stands twice in the mutation \`${row.mutation}\`, ` +
                        `first at \`data.sounds.mutations[${mutationAt.get(key)}]\``,
                ),
            );
        else mutationAt.set(key, i);
    });

    const harmony = isMap(sounds.syllables?.harmony) ? sounds.syllables.harmony : {};
    if (isMap(harmony.partners)) {
        const front = new Set(listOf(harmony.front));
        const vowels = new Set([...listOf(harmony.back), ...front, ...listOf(harmony.neutral)]);
        for (const [vowel, partner] of Object.entries(harmony.partners)) {
            const path = ["data", "sounds", "syllables", "harmony", "partners", vowel];
            if (!vowels.has(vowel))
                findings.push(
                    finding(
                        path,
                        "error",
                        `\`${vowel}\` is not a vowel of \`data.sounds.syllables.harmony\``,
                        true,
                    ),
                );
            else if (typeof partner === "string" && !front.has(partner))
                findings.push(
                    finding(
                        path,
                        "error",
                        `the partner \`${partner}\` of \`${vowel}\` is not one of the harmony's ` +
                            "`front` vowels",
                    ),
                );
        }
    }

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

    // ── Older forms and negation ─────────────────────────────────────────────
    const olderAt = new Map();
    listOf(data.older).forEach((row, i) => {
        if (!isMap(row) || typeof row.form !== "string") return;
        if (olderAt.has(row.form))
            findings.push(
                finding(
                    ["data", "older", i, "form"],
                    "error",
                    `the form \`${row.form}\` stands twice, first at \`data.older[${olderAt.get(row.form)}]\``,
                ),
            );
        else olderAt.set(row.form, i);
    });
    const negation = isMap(data.negation) ? data.negation : {};
    if (typeof negation.mutation === "string") {
        const named = new Set(
            listOf(sounds.mutations)
                .filter((row) => isMap(row) && typeof row.mutation === "string")
                .map((row) => row.mutation),
        );
        if (!named.has(negation.mutation))
            findings.push(
                finding(
                    ["data", "negation", "mutation"],
                    "error",
                    `the mutation \`${negation.mutation}\` is not one of \`data.sounds.mutations\``,
                ),
            );
    }

    // ── Naming ───────────────────────────────────────────────────────────────
    const naming = isMap(data.naming) ? data.naming : {};
    /**
     * A finding at the second of two entries sharing a key.
     *
     * @param {string} list - The list under `data.naming`.
     * @param {(row: object) => string|undefined} keyOf - The entry's key.
     * @param {(row: object, first: number) => [Array<string|number>, string]} report
     *   - Where the second sits, relative to its entry, and what is said.
     */
    const once = (list, keyOf, report) => {
        const seen = new Map();
        listOf(naming[list]).forEach((row, i) => {
            if (!isMap(row)) return;
            const key = keyOf(row);
            if (key === undefined) return;
            if (seen.has(key)) {
                const [rest, message] = report(row, seen.get(key));
                findings.push(finding(["data", "naming", list, i, ...rest], "error", message));
            } else seen.set(key, i);
        });
    };
    once(
        "shapes",
        (row) => (typeof row.of === "string" ? row.of : undefined),
        (row, first) => [
            ["of"],
            `the class of name \`${row.of}\` has its shape stated twice, first at ` +
                `\`data.naming.shapes[${first}]\``,
        ],
    );
    once(
        "edges",
        (row) =>
            typeof row.edge === "string" ?
                JSON.stringify([row.edge, row.of ?? ANY_NAME])
            :   undefined,
        (row, first) => [
            ["edge"],
            `the edge \`${row.edge}\` of \`${row.of ?? ANY_NAME}\` stands twice, first at ` +
                `\`data.naming.edges[${first}]\``,
        ],
    );
    once(
        "draws",
        (row) => (typeof row.kind === "string" ? row.kind : undefined),
        (row, first) => [
            ["kind"],
            `the kind \`${row.kind}\` has its draws stated twice, first at ` +
                `\`data.naming.draws[${first}]\``,
        ],
    );
    listOf(naming.shapes).forEach((row, i) => {
        if (!isMap(row)) return;
        const at = (...rest) => ["data", "naming", "shapes", i, ...rest];
        if (row.syllables == null && row.perVowel == null)
            findings.push(
                finding(
                    at(),
                    "error",
                    `\`data.naming.shapes[${i}]\` states neither \`syllables\` nor \`perVowel\``,
                ),
            );
        for (const key of ["syllables", "perVowel"]) {
            const range = row[key];
            if (!isMap(range) || typeof range.min !== "number" || typeof range.max !== "number")
                continue;
            if (range.min > range.max)
                findings.push(
                    finding(
                        at(key),
                        "error",
                        `\`data.naming.shapes[${i}].${key}\` runs from ${range.min} to ${range.max}; ` +
                            "its `min` is above its `max`",
                    ),
                );
        }
    });
    listOf(naming.heldFrom).forEach((row, i) => {
        if (!isMap(row) || !HELD_TAKES.includes(row.takes)) return;
        const at = (...rest) => ["data", "naming", "heldFrom", i, ...rest];
        const label = `\`data.naming.heldFrom[${i}]\``;
        if (row.takes === "element") {
            if (!listOf(row.elements).length)
                findings.push(
                    finding(
                        at(),
                        "error",
                        `${label} takes an \`element\` and names no \`elements\``,
                    ),
                );
        } else if (row.elements != null)
            findings.push(
                finding(
                    at("elements"),
                    "error",
                    `\`elements\` lists what a place takes first, and ${label} takes a ` +
                        `\`${row.takes}\``,
                    true,
                ),
            );
        if (!HELD_NAMES.includes(row.takes))
            for (const key of ["clip", "joining"])
                if (row[key] != null)
                    findings.push(
                        finding(
                            at(key),
                            "error",
                            `\`${key}\` shapes a name, and ${label} takes a \`${row.takes}\``,
                            true,
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
