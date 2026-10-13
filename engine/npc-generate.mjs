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
 * The engine behind `package-build npc new`: a spec in, a complete being note
 * out.
 *
 * A spec is a possibly incomplete set of frontmatter fields. `data.culture`
 * and `data.gender` are required; every other field the being needs is
 * generated where the spec leaves it out, and a field the spec gives is
 * written exactly as given, at every depth. Two top-level keys are not
 * frontmatter: `appearance` and `dossier` are the markdown bodies of the
 * note's two sections, written verbatim.
 *
 * **Generation is seeded from the spec.** The seed is the spec's canonical
 * serialisation — JSON with every map's keys sorted — joined to the optional
 * `seed` the caller hands in. Each field draws from its own stream, seeded by
 * that and the field's path, so the same spec and seed always give the same
 * note, whether or not the spec states a name.
 *
 * What is generated, and from where:
 *
 * - `name.full` — drawn from the culture's language's name lists by their
 *   pattern, the given name from the list for `data.gender` (see
 *   `language-names.mjs`). A name the spec states is kept, and must fit those
 *   lists: every placeholder filled by a name of its list, the given name from
 *   the gender's.
 * - `shortcode` — the name transliterated to lowercase ASCII letters and
 *   digits, cut to twelve characters, with a counter replacing its tail where a
 *   being in the package already holds it.
 * - `type: being`, `subType: npc`, `tags: [generated, draft]`.
 * - `frame`, and `appearance.eye_color`, `hair_color`, `skin_color` and
 *   `complexion` — weighted draws from the culture's appearance profile.
 * - `height` — from the profile's range for the gender, in feet and inches.
 * - `weight` — from the height and the frame's body-mass band, in pounds.
 * - `born` — an adult age of {@link ADULT_AGE} years before the package's
 *   present, as a neutral `<year>.<day>` date. A package that states no present
 *   gets `born: unknown`.
 * - `archetypes: [commoner]`, the archetype for a person who fits no more
 *   specific one.
 * - `icon`, `species` and `packFolder` — what the caller derives from the
 *   package's other beings; left out where it derives nothing.
 * - `templatePriority`, `occupation` and `died` are `null`; `lore` and `homes`
 *   are `[]`; `affiliations` is `{}`; `appearance.extra_features` is `[]`.
 *
 * Plain ESM with no filesystem access; the CLI resolves the culture, its
 * language's name lists and the present and hands them in.
 *
 * @module
 */

import unidecode from "unidecode";
import YAML from "yaml";
import { BEING_LOOK_VOCABULARY } from "./note-vocabulary.mjs";
import { FRAME_MASS_INDEX, profileLookKeys } from "./appearance-profile.mjs";
import { parseBeingHeight } from "./being-measurements.mjs";
import { computeAge, parseAgeMagnitude } from "./being-age.mjs";
import { parseNoteDate } from "./note-dates.mjs";
import { eraYear } from "./calendars.mjs";
import { parseAddress, renderAddress } from "./address.mjs";
import { isPlainMap } from "./data-keys.mjs";
import { drawName, nameMisfit } from "./language-names.mjs";

/** The youngest and oldest age, in whole years, a generated person is born to. */
export const ADULT_AGE = Object.freeze({ min: 18, max: 60 });

/** The longest shortcode the derivation makes. */
export const SHORTCODE_LENGTH = 12;

/** The spec fields `npc new` requires, as paths. */
export const REQUIRED_SPEC_FIELDS = Object.freeze(["data.culture", "data.gender"]);

/** The top-level spec keys that are section bodies rather than frontmatter. */
const PROSE_KEYS = Object.freeze(["appearance", "dossier"]);

const INCHES_PER_METRE = 39.3701;
const POUNDS_PER_KILOGRAM = 2.20462;

/** A 32-bit hash of a string (cyrb53's low half), the seed of one stream. */
function hash(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    return h1 >>> 0;
}

/**
 * A deterministic stream of numbers in `[0, 1)` (mulberry32), seeded by the
 * generation's seed and the path of the field it draws.
 *
 * @param {string} seed - The canonical spec and the caller's seed.
 * @param {string} field - The field's path.
 * @returns {() => number} The stream.
 */
function stream(seed, field) {
    let state = hash(`${seed}\u0000${field}`);
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** One word drawn from a map of words to weights, in the map's own order. */
function weighted(weights, next) {
    const entries = Object.entries(weights).filter(([, w]) => Number(w) > 0);
    const total = entries.reduce((sum, [, w]) => sum + Number(w), 0);
    let point = next() * total;
    for (const [word, w] of entries) {
        point -= Number(w);
        if (point < 0) return word;
    }
    return entries.at(-1)?.[0];
}

/**
 * A value as JSON with every map's keys sorted, so two specs stating the same
 * fields in a different order serialise alike.
 *
 * @param {unknown} value - A spec, or any value in one.
 * @returns {string} The canonical serialisation.
 */
export function canonicalSpec(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalSpec).join(",")}]`;
    if (value !== null && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => `${JSON.stringify(key)}:${canonicalSpec(value[key])}`)
            .join(",")}}`;
    return JSON.stringify(value) ?? "null";
}

/** Whether a spec value counts as given — any value but `undefined`. */
const given = (value) => value !== undefined;

/** The value at a dotted path, or `undefined`. */
function at(object, path) {
    let value = object;
    for (const segment of path.split(".")) {
        value = isPlainMap(value) ? value[segment] : undefined;
    }
    return value;
}

/**
 * Why a spec cannot be generated from, or nothing.
 *
 * @param {unknown} spec - The spec as read.
 * @returns {string[]} One sentence per problem.
 */
export function npcSpecProblems(spec) {
    if (!isPlainMap(spec)) return ["the spec must be a map of frontmatter fields"];
    const problems = [];
    for (const field of REQUIRED_SPEC_FIELDS) {
        const value = at(spec, field);
        if (typeof value !== "string" || !value.trim())
            problems.push(`the spec must state \`${field}\``);
    }
    if (given(spec.name) && !isPlainMap(spec.name))
        problems.push("`name` must be a map, such as `{full: ...}`");
    else if (
        given(spec.name?.full) &&
        (typeof spec.name.full !== "string" || !spec.name.full.trim())
    )
        problems.push("the spec's `name.full`, when stated, must be a name");
    if (given(spec.type) && spec.type !== "being")
        problems.push(`the spec states \`type: ${spec.type}\`; \`npc new\` writes a being`);
    const genders = BEING_LOOK_VOCABULARY.gender.map(({ value }) => value);
    const gender = at(spec, "data.gender");
    if (typeof gender === "string" && gender.trim() && !genders.includes(gender))
        problems.push(
            `\`data.gender\` is ${JSON.stringify(gender)}; it takes ${genders.join(", ")}`,
        );
    for (const key of PROSE_KEYS) {
        if (given(spec[key]) && typeof spec[key] !== "string")
            problems.push(`\`${key}\` is the ${key} section's markdown, so it must be a string`);
    }
    return problems;
}

/**
 * The shortcode a name derives, free of every shortcode in `taken`.
 *
 * @param {string} name - `name.full`.
 * @param {ReadonlySet<string>} taken - Shortcodes the package's beings hold.
 * @returns {string} The shortcode.
 */
export function npcShortcode(name, taken) {
    const base =
        unidecode(name)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .slice(0, SHORTCODE_LENGTH) || "npc";
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
        const candidate = base.slice(0, SHORTCODE_LENGTH - String(n).length) + n;
        if (!taken.has(candidate)) return candidate;
    }
}

/** A whole number of inches as `6' 4"`. */
function frontmatterHeight(inches) {
    return `${Math.floor(inches / 12)}' ${inches % 12}"`;
}

/** A height value as prose: `6'4"`. */
function proseHeight(value) {
    const inches = parseBeingHeight(value);
    if (inches === null) return String(value);
    return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/**
 * The height range a gender draws from: its own, or the span of every range
 * the profile states.
 */
function heightRange(profile, gender) {
    const ranges =
        isPlainMap(profile.height?.[gender]) ?
            [profile.height[gender]]
        :   Object.values(profile.height ?? {}).filter(isPlainMap);
    const mins = ranges.map((r) => parseBeingHeight(r.min)).filter((v) => v !== null);
    const maxes = ranges.map((r) => parseBeingHeight(r.max)).filter((v) => v !== null);
    return { min: Math.min(...mins), max: Math.max(...maxes) };
}

/** A height in whole inches, peaked towards the middle of its range. */
function drawHeight(range, next) {
    const middle = (next() + next()) / 2;
    return Math.round(range.min + (range.max - range.min) * middle);
}

/** A weight in whole pounds, inside the frame's body-mass band at this height. */
function drawWeight(inches, frame, next) {
    const [low, high] = FRAME_MASS_INDEX[frame] ?? FRAME_MASS_INDEX.medium;
    // Kept off the band's edges, so rounding to whole pounds stays inside it.
    const index = low + 0.1 + (high - low - 0.2) * next();
    const metres = inches / INCHES_PER_METRE;
    return Math.round(index * metres * metres * POUNDS_PER_KILOGRAM);
}

/** The frame whose body-mass band holds a height and weight, if both read. */
function frameOf(height, weight) {
    const inches = parseBeingHeight(height);
    const match = /^(\d+) ?lbs$/.exec(String(weight ?? ""));
    const metric = /^(\d+(?:\.\d+)?) ?kg$/.exec(String(weight ?? ""));
    const kilograms =
        match ? Number(match[1]) / POUNDS_PER_KILOGRAM
        : metric ? Number(metric[1])
        : typeof weight === "number" ? weight
        : null;
    if (inches === null || kilograms === null) return undefined;
    const metres = inches / INCHES_PER_METRE;
    const index = kilograms / (metres * metres);
    const frames = Object.keys(FRAME_MASS_INDEX);
    return (
        frames.find((f) => index >= FRAME_MASS_INDEX[f][0] && index < FRAME_MASS_INDEX[f][1]) ??
        (index < FRAME_MASS_INDEX[frames[0]][0] ? frames[0] : frames.at(-1))
    );
}

/**
 * A neutral birth date `age` whole years before the present, or `unknown` where
 * the present does not read.
 */
function drawBorn(age, present, dateContext, next) {
    if (present === undefined || present === null) return "unknown";
    const parsed = parseNoteDate(present, { ...dateContext, allowUnknown: false }).date;
    if (!parsed?.known || parsed.canonicalYear == null) return "unknown";
    const days = dateContext?.daysPerYear;
    const day = Number.isSafeInteger(days) && days > 0 ? 1 + Math.floor(next() * days) : null;
    const year = eraYear(parsed.canonicalYear - age);
    const text = (y) => (day === null ? String(y) : `${y}.${day}`);
    for (const candidate of [year, year - 1, year + 1]) {
        if (computeAge(text(candidate), present, dateContext) === age) return text(candidate);
    }
    return text(year);
}

/** A vocabulary word as running prose reads it: its label, lowercased. */
function wordLabel(field, value) {
    const word = BEING_LOOK_VOCABULARY[field]?.find((w) => w.value === value);
    return (word?.label ?? String(value).replaceAll("_", " ")).toLowerCase();
}

/** `a`, `a and b`, or `a, b, and c`. */
function series(items) {
    if (items.length < 3) return items.join(" and ");
    return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** The noun and pronouns a gender is written with. */
function person(gender) {
    if (gender === "male") return { noun: "man", subject: "He", has: "has", possessive: "His" };
    if (gender === "female")
        return { noun: "woman", subject: "She", has: "has", possessive: "Her" };
    return { noun: "person", subject: "They", has: "have", possessive: "Their" };
}

/** `a` or `an`, for the age or noun that follows it. */
function article(next) {
    return /^(?:8|11(?!\d)|18(?!\d)|[aeiou])/i.test(next) ? "an" : "a";
}

/**
 * The Appearance section's paragraph, in the Folk wording: "Ahmetega Zekar is
 * a 39-year-old man who stands 6'4" tall with a heavy build. He has tawny
 * skin, weathered complexion, black hair, and brown eyes."
 *
 * A fact that is absent leaves its clause out.
 *
 * @param {object} facts
 * @param {string} facts.name - `name.full`.
 * @param {number|null} [facts.age] - Whole years, or `null` where unknown.
 * @param {string} [facts.gender]
 * @param {unknown} [facts.height]
 * @param {string} [facts.frame]
 * @param {object} [facts.appearance] - The `data.appearance` map.
 * @returns {string} The paragraph.
 */
export function appearanceParagraph({ name, age, gender, height, frame, appearance = {} }) {
    const who = person(gender);
    const described = age === null || age === undefined ? who.noun : `${age}-year-old ${who.noun}`;
    let first = `${name} is ${article(described)} ${described}`;
    if (height !== undefined && height !== null) first += ` who stands ${proseHeight(height)} tall`;
    if (frame)
        first += ` with ${article(wordLabel("frame", frame))} ${wordLabel("frame", frame)} build`;
    const sentences = [`${first}.`];

    const look = appearance ?? {};
    const complexion = [look.complexion ?? []]
        .flat()
        .filter(Boolean)
        .map((w) => wordLabel("appearance.complexion", w));
    const parts = [
        look.skin_color && `${wordLabel("appearance.skin_color", look.skin_color)} skin`,
        complexion.length && `${series(complexion)} complexion`,
        look.hair_color && `${wordLabel("appearance.hair_color", look.hair_color)} hair`,
        look.eye_color && `${wordLabel("appearance.eye_color", look.eye_color)} eyes`,
    ].filter(Boolean);
    if (parts.length) sentences.push(`${who.subject} ${who.has} ${series(parts)}.`);

    const features = (Array.isArray(look.extra_features) ? look.extra_features : []).filter(
        (f) => typeof f === "string" && f.trim(),
    );
    if (features.length) sentences.push(`${who.possessive} features include ${series(features)}.`);
    return sentences.join(" ");
}

/** The `data:` keys of a being, in the order a generated note writes them. */
const DATA_ORDER = Object.freeze([
    "icon",
    "templatePriority",
    "archetypes",
    "occupation",
    "lore",
    "culture",
    "homes",
    "affiliations",
    "gender",
    "species",
    "born",
    "died",
    "height",
    "weight",
    "frame",
    "appearance",
    "packFolder",
]);

/** The top-level keys, in the order a generated note writes them. */
const TOP_ORDER = Object.freeze([
    "shortcode",
    "name",
    "type",
    "subType",
    "description",
    "tags",
    "data",
]);

/** `values`' keys in `order`, then any others in their own order. */
function ordered(values, order) {
    const out = {};
    for (const key of order) if (given(values[key])) out[key] = values[key];
    for (const [key, value] of Object.entries(values)) if (!(key in out)) out[key] = value;
    return out;
}

/** The frontmatter as YAML: lists of scalars and the name map in flow style. */
function frontmatterYaml(frontmatter) {
    const doc = new YAML.Document(frontmatter);
    YAML.visit(doc, {
        Seq(_, node) {
            if (node.items.every((item) => YAML.isScalar(item))) node.flow = true;
        },
        Map(_, node) {
            if (!node.items.length) node.flow = true;
        },
    });
    const name = doc.get("name", true);
    if (YAML.isMap(name)) name.flow = true;
    return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/**
 * Generate a being note from a spec.
 *
 * @param {object} spec - The spec: frontmatter fields, plus `appearance` and
 *   `dossier` section bodies.
 * @param {object} context
 * @param {object} context.profile - The culture's appearance profile, already
 *   checked by `profileProblems`.
 * @param {object} context.names - The language's `data.names`, already checked
 *   by `namesProblems`.
 * @param {string} [context.language] - The language's Address, for an error
 *   about a name that does not fit.
 * @param {string} [context.seed] - Text joined to the spec's own seed, to draw a
 *   different person from the same spec.
 * @param {unknown} [context.present] - The package's present, or `null`.
 * @param {object} [context.dateContext] - The reckoning context the present
 *   and `born` are read in, with `daysPerYear`.
 * @param {{icon?: unknown, species?: unknown, packFolder?: unknown}} [context.defaults] -
 *   Values derived from the package's other beings.
 * @param {ReadonlySet<string>} [context.taken] - Shortcodes the package's beings hold.
 * @returns {{frontmatter: object, body: string, text: string}} The note.
 * @throws {Error} Where the spec has problems, or states a `name.full` that
 *   does not fit the language's lists; that error carries `keyPath`
 *   `["name", "full"]`.
 */
export function generateNpc(spec, context) {
    const problems = npcSpecProblems(spec);
    if (problems.length) throw new Error(problems.join("; "));
    const { profile, names, present = null, dateContext = {}, defaults = {} } = context;
    if (!isPlainMap(names)) throw new Error("`npc new` needs the language's `data.names`");
    const taken = context.taken ?? new Set();
    const seed = canonicalSpec(spec) + (given(context.seed) ? `\u0000${context.seed}` : "");
    const draw = (field) => stream(seed, field);
    const data = isPlainMap(spec.data) ? spec.data : {};
    const look = isPlainMap(data.appearance) ? data.appearance : {};
    const gender = data.gender;
    const statedName = spec.name?.full;
    if (given(statedName)) {
        const misfit = nameMisfit(statedName, names, gender);
        if (misfit)
            throw Object.assign(
                new Error(
                    `name.full ${JSON.stringify(statedName)} does not fit the names of ` +
                        `${context.language ?? "the language"}: ${misfit}`,
                ),
                { keyPath: ["name", "full"] },
            );
    }
    const name = given(statedName) ? statedName : drawName(names, gender, draw("name.full"));

    const height =
        given(data.height) ?
            data.height
        :   frontmatterHeight(drawHeight(heightRange(profile, gender), draw("data.height")));
    const frame =
        given(data.frame) ?
            data.frame
        :   (given(data.weight) && frameOf(height, data.weight)) ||
            weighted(profile.frame, draw("data.frame"));
    const weight =
        given(data.weight) ?
            data.weight
        :   `${drawWeight(parseBeingHeight(height) ?? 0, frame, draw("data.weight"))} lbs`;
    const agePick = draw("data.born");
    const age = ADULT_AGE.min + Math.floor(agePick() * (ADULT_AGE.max - ADULT_AGE.min + 1));
    const born = given(data.born) ? data.born : drawBorn(age, present, dateContext, agePick);

    const appearance = { ...look };
    for (const key of profileLookKeys(BEING_LOOK_VOCABULARY)) {
        if (key === "frame" || given(look[key])) continue;
        appearance[key] = weighted(profile[key], draw(`data.appearance.${key}`));
    }
    if (!given(look.extra_features)) appearance.extra_features = [];

    const generated = {
        templatePriority: null,
        archetypes: ["commoner"],
        occupation: null,
        lore: [],
        homes: [],
        affiliations: {},
        died: null,
        ...Object.fromEntries(
            ["icon", "species", "packFolder"]
                .filter((key) => given(defaults[key]) && defaults[key] !== null)
                .map((key) => [key, defaults[key]]),
        ),
    };
    const fullData = ordered(
        {
            ...generated,
            ...data,
            born,
            height,
            weight,
            frame,
            appearance: ordered(appearance, [
                ...profileLookKeys(BEING_LOOK_VOCABULARY).filter((k) => k !== "frame"),
                "extra_features",
            ]),
        },
        DATA_ORDER,
    );

    const frontmatterSpec = Object.fromEntries(
        Object.entries(spec).filter(([key]) => !PROSE_KEYS.includes(key)),
    );
    const frontmatter = ordered(
        {
            shortcode: npcShortcode(name, taken),
            type: "being",
            subType: "npc",
            tags: ["generated", "draft"],
            ...frontmatterSpec,
            name: { full: name, ...(isPlainMap(spec.name) ? spec.name : {}) },
            data: fullData,
        },
        TOP_ORDER,
    );

    const computed = computeAge(born, present, dateContext);
    const stated = given(data.age) ? parseAgeMagnitude(data.age)?.value : undefined;
    const paragraph =
        given(spec.appearance) ?
            spec.appearance
        :   appearanceParagraph({
                name,
                age: stated ?? computed,
                gender,
                height,
                frame,
                appearance: fullData.appearance,
            });
    const section = (text) => (text.endsWith("\n") ? text : `${text}\n`);
    const body =
        `\n# Appearance {#appearance}\n\n${section(paragraph)}\n# Dossier {#dossier}\n` +
        (given(spec.dossier) && spec.dossier !== "" ? `\n${section(spec.dossier)}` : "");
    return { frontmatter, body, text: `---\n${frontmatterYaml(frontmatter)}---\n${body}` };
}

/**
 * The canonical Address a `data.culture` value names, read as a culture
 * reference is: a `lore` note in this package unless it says otherwise.
 *
 * @param {unknown} value - The value as written, or a decoded tuple.
 * @param {object} index - The link index.
 * @returns {string|undefined} The Address, or `undefined` where it reads as none.
 */
export function cultureKey(value, index) {
    const tuple = parseAddress(value, {
        package: index?.contentPackage,
        system: "note",
        type: "lore",
        types: index?.types,
        packages: index?.packages,
    });
    return tuple.reason ? undefined : renderAddress(tuple);
}

/**
 * A note's `data:` as its author wrote it, Addresses still in their written
 * form, or `undefined` where the frontmatter does not parse.
 *
 * @param {string|undefined} raw - The note's full text.
 * @returns {object|undefined} The authored `data:` map.
 */
function authoredData(raw) {
    const match = /^---\n([\s\S]*?)\n---/.exec(raw ?? "");
    if (!match) return undefined;
    try {
        const data = YAML.parse(match[1])?.data;
        return isPlainMap(data) ? data : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The commonest value of each of `icon`, `species` and `packFolder` among the
 * package's npcs, as their notes write it: those of the same culture first,
 * then any npc. A tie goes to the value that sorts first.
 *
 * @param {object} index - The link index.
 * @param {string|undefined} culture - The culture's canonical Address.
 * @returns {{icon?: unknown, species?: unknown, packFolder?: unknown, taken: Set<string>}}
 *   The defaults, and the shortcodes the package's beings hold.
 */
export function npcDefaults(index, culture) {
    const beings = (index?.notes ?? []).filter((note) => note.type === "being");
    const npcs = beings.filter((note) => note.fm?.subType === "npc");
    const kin = npcs.filter(
        (note) => culture && cultureKey(note.fm?.data?.culture, index) === culture,
    );
    const written = new Map(npcs.map((note) => [note, authoredData(note.raw)]));
    const commonest = (notes, key) => {
        const counts = new Map();
        for (const note of notes) {
            const value = written.get(note)?.[key];
            if (typeof value !== "string" || !value.trim()) continue;
            counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    };
    const out = { taken: new Set(beings.map((note) => note.fm?.shortcode).filter(Boolean)) };
    for (const key of ["icon", "species", "packFolder"]) {
        const value = commonest(kin, key) ?? commonest(npcs, key);
        if (value !== undefined) out[key] = value;
    }
    return out;
}
