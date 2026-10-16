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
 * The keys a language note states beside its words: the register of the names
 * the setting gives in the language's reach, the tags the register uses, the
 * forms it does not write, the notes the register covers, the letters and sound
 * rules, the sound changes, the name elements, the roots, the cognates, the
 * forms older than the rules and the negative particle.
 *
 * A leaf module, importing nothing: the note vocabulary reads these
 * declarations as it loads, and `language-data.mjs` checks what the values
 * mean. Every closed list here — the edges, element positions, register
 * kinds, stress rules, joins, marks, onsets, harmony sets, cluster uses and
 * calling-name uses — holds the labels the setting's own tables use, one word
 * for each.
 *
 * @module
 */

/** The `data` keys a language note states its sounds, names and history in. */
export const LANGUAGE_DATA_KEYS = Object.freeze([
    "tongues",
    "register",
    "retired",
    "scope",
    "sounds",
    "soundChanges",
    "elements",
    "roots",
    "cognates",
    "callingNames",
    "older",
    "negation",
    "naming",
    "grammar",
]);

/**
 * The tongue tag every language accepts without declaring it: a name given in
 * the language of the pages.
 */
export const RESERVED_TONGUE = "translation";

/**
 * The placeholder a tongue tag closes on to declare a family of tags, one per
 * tongue named after the colon: `exonym:<tongue>` declares `exonym:vylari`.
 */
export const TONGUE_PLACEHOLDER = "<tongue>";

/**
 * The edges of a word a sound rule names: what may open it, close it, stand
 * inside it, and what counts as a syllable.
 */
export const EDGE_KINDS = Object.freeze([
    "openConsonant",
    "openCluster",
    "closeConsonant",
    "closeCluster",
    "innerCluster",
    "vowelPair",
    "glide",
    "syllabic",
]);

/** What each edge kind holds, for the reference and for a finding. */
export const EDGE_MEANINGS = Object.freeze({
    openConsonant: "the single consonants that may open a word, where not every one may",
    openCluster: "the clusters that may open a word",
    closeConsonant: "the consonants that may close a word",
    closeCluster: "the clusters that may close a word",
    innerCluster: "the pairs that may stand together inside a word",
    vowelPair: "the vowels that may stand together",
    glide: "the glides that may follow a consonant",
    syllabic: "the consonants that may carry a syllable",
});

/** The word a sound rule's `sounds` takes in place of a list: every sound. */
export const ANY_SOUND = "any";

/**
 * Where in a name an element stands: `opening` opens a name or stands inside
 * it, `closing` closes it, `either` does both, and `link` joins two parts and
 * never begins or ends a name.
 */
export const ELEMENT_POSITIONS = Object.freeze(["opening", "closing", "either", "link"]);

/**
 * What a register name is, where a language sorts its names by kind, and the
 * kind of name an element builds.
 */
export const REGISTER_KINDS = Object.freeze(["byname", "given", "place"]);

/**
 * The class of name a naming shape or edge holds for: every name, a given or a
 * clan name, or a name by how it is built — `bound` a stem and an ending,
 * `compound` elements alone.
 */
export const NAME_CLASSES = Object.freeze(["name", "given", "clan", "bound", "compound"]);

/** The class of name a naming edge holds for where it states none. */
export const ANY_NAME = "name";

/**
 * What a place name takes first from what it is held from: a name-stem, a
 * god's name, a founder's given name, or one of the listed elements.
 */
export const HELD_TAKES = Object.freeze(["stem", "godName", "givenName", "element"]);

/** The `takes` values that are a name a place name shapes. */
export const HELD_NAMES = Object.freeze(["godName", "givenName"]);

/** How a name is clipped where a place name takes it. */
export const HELD_CLIPS = Object.freeze(["first"]);

/** How often a group of clusters stands inside a word. */
export const CLUSTER_USES = Object.freeze(["common", "sparing"]);

/** Where a language's stress falls. */
export const STRESS_RULES = Object.freeze([
    "first syllable",
    "penultimate or final",
    "by weight",
    "as marked",
]);

/** Which sounds meet where two parts of a word join. */
export const JOIN_MEETINGS = Object.freeze(["C+C", "V+C", "V+V"]);

/**
 * What happens where they meet: `merge` writes one, `insert` sets the join's
 * letters between, `drop` loses the first, `double` doubles the consonant.
 */
export const JOIN_RULES = Object.freeze(["merge", "insert", "drop", "double"]);

/** What a written mark says of its letter. */
export const MARK_KINDS = Object.freeze(["stress", "length"]);

/** How many of a mark a word may carry: `one` at most, or `any` number. */
export const MARK_LIMITS = Object.freeze(["one", "any"]);

/** What a syllable may open on, where the rule is stated. */
export const ONSET_RULES = Object.freeze(["single"]);

/** Which harmony a neutral vowel counts as. */
export const HARMONY_SETS = Object.freeze(["back", "front"]);

/** Whose name a calling-name closing usually makes. */
export const CALLING_USES = Object.freeze(["man", "woman", "either"]);

/** A list of strings, as an inner key's `entries`. */
const STRINGS = Object.freeze({ kind: "string", shape: "a string" });

/**
 * The keys of one `data.tongues` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const TONGUE_FIELDS = Object.freeze([
    Object.freeze({
        name: "tag",
        kind: "string",
        required: true,
        shape: "a tag such as `dunhari`, or `exonym:<tongue>`",
        describe:
            "The tag a register row's `tongue` names: lowercase letters and digits, or a tag " +
            "closing on `:<tongue>`, which declares one tag per tongue named after the colon.",
    }),
    Object.freeze({
        name: "meaning",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What a name of this tongue is.",
    }),
    Object.freeze({
        name: "language",
        kind: "address",
        shape: "a language skill Address",
        describe: "The language note the tag names, where it is one.",
    }),
]);

/**
 * The keys of one `data.register` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const REGISTER_FIELDS = Object.freeze([
    Object.freeze({
        name: "name",
        kind: "string",
        required: true,
        shape: "a name as the setting writes it",
        describe: "A name the setting gives, as it is written.",
    }),
    Object.freeze({
        name: "tongue",
        kind: "string",
        shape: "a tag of `data.tongues`, or `translation`",
        describe:
            "The tongue the name is in, as a tag `data.tongues` declares, or `translation`. A row " +
            "states a `tongue`, a `kind`, or both.",
    }),
    Object.freeze({
        name: "kind",
        kind: "string",
        allowed: REGISTER_KINDS,
        shape: `one of ${REGISTER_KINDS.join(", ")}`,
        describe: "What kind of name it is, in a language that sorts its names by kind.",
    }),
    Object.freeze({
        name: "built",
        kind: "list",
        shape: "a list of pieces",
        entries: STRINGS,
        describe: "The pieces the name is built from, in order, as a word's `built` writes them.",
    }),
    Object.freeze({
        name: "gloss",
        kind: "string",
        shape: "a string",
        describe: "What the name means, where the pages give its sense.",
    }),
    Object.freeze({
        name: "why",
        kind: "string",
        shape: "a string",
        describe: "Why the name stands outside the pattern the language's names are built by.",
    }),
]);

/**
 * The keys of one `data.retired` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const RETIRED_FIELDS = Object.freeze([
    Object.freeze({
        name: "form",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "The form the setting does not write.",
    }),
    Object.freeze({
        name: "instead",
        kind: "string-or-list",
        shape: "a string, or a list of them",
        entries: STRINGS,
        describe: "What is written in its place, one form or several; absent where nothing is.",
    }),
    Object.freeze({
        name: "why",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "Why the setting does not write it.",
    }),
]);

/**
 * The keys of a language's `data.scope`: the notes its register covers. A note
 * is in scope when any one of them catches it and `skip` does not name it.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const SCOPE_FIELDS = Object.freeze([
    Object.freeze({
        name: "folders",
        kind: "list",
        shape: "a list of folder Addresses",
        entries: Object.freeze({ kind: "address", shape: "a folder Address" }),
        describe: "Every note whose `data.packFolder` is one of these folders.",
    }),
    Object.freeze({
        name: "cultures",
        kind: "list",
        shape: "a list of culture Addresses",
        entries: Object.freeze({ kind: "address", shape: "a culture Address" }),
        describe: "Every note whose `data.culture` is one of these cultures.",
    }),
    Object.freeze({
        name: "lore",
        kind: "list",
        shape: "a list of lore Addresses",
        entries: Object.freeze({ kind: "address", shape: "a lore Address" }),
        describe: "Every note whose `data.lore` names one of these notes.",
    }),
    Object.freeze({
        name: "parents",
        kind: "list",
        shape: "a list of Addresses",
        entries: Object.freeze({ kind: "address", shape: "a place or affiliation Address" }),
        describe: "Every note whose `data.parents` names one of these notes.",
    }),
    Object.freeze({
        name: "addresses",
        kind: "list",
        shape: "a list of Addresses",
        entries: Object.freeze({ kind: "address", shape: "an Address" }),
        describe: "These notes themselves.",
    }),
    Object.freeze({
        name: "paths",
        kind: "list",
        shape: "a list of content paths",
        entries: Object.freeze({ kind: "string", shape: "a path such as `Regions/Aelwyth/`" }),
        describe: "Every note whose file sits below one of these paths of the content tree.",
    }),
    Object.freeze({
        name: "types",
        kind: "list",
        shape: "a list of note types",
        entries: Object.freeze({ kind: "string", shape: "a note type" }),
        describe:
            "The note types the register covers; where stated, a note of another type is out " +
            "of scope whatever else catches it.",
    }),
    Object.freeze({
        name: "skip",
        kind: "list",
        shape: "a list of Addresses",
        entries: Object.freeze({ kind: "address", shape: "an Address" }),
        describe: "Notes out of scope whatever else catches them.",
    }),
]);

/**
 * The keys of one `data.sounds.letters` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const LETTER_FIELDS = Object.freeze([
    Object.freeze({
        name: "letters",
        kind: "list",
        required: true,
        shape: "a list of letters",
        entries: STRINGS,
        describe: "The letters or digraphs the row describes, as written.",
    }),
    Object.freeze({
        name: "kind",
        kind: "string",
        required: true,
        shape: "a string, such as `consonant` or `long vowel`",
        describe: "What kind of sound they write.",
    }),
    Object.freeze({
        name: "like",
        kind: "string",
        shape: "a string",
        describe: "What they sound like; absent where the row states only their kind and place.",
    }),
    Object.freeze({
        name: "place",
        kind: "string",
        shape: "a string, such as `lips` or `tongue-tip`",
        describe: "Where in the mouth they are made.",
    }),
    Object.freeze({
        name: "tongue",
        kind: "string-or-list",
        shape: "a tag, or a list of them",
        entries: STRINGS,
        describe:
            "The tongues that write them, as tags `data.tongues` declares; every one where absent.",
    }),
]);

/**
 * The keys of one `data.sounds.edges` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const EDGE_FIELDS = Object.freeze([
    Object.freeze({
        name: "edge",
        kind: "string",
        required: true,
        allowed: EDGE_KINDS,
        shape: `one of ${EDGE_KINDS.join(", ")}`,
        describe: "Which edge of a word the sounds stand at.",
    }),
    Object.freeze({
        name: "sounds",
        kind: "string-or-list",
        required: true,
        allowed: Object.freeze([ANY_SOUND]),
        shape: `a list of sounds, or \`${ANY_SOUND}\``,
        entries: STRINGS,
        describe: `The sounds, as written; \`${ANY_SOUND}\` for every one, and an empty list for none.`,
    }),
]);

/**
 * The keys of one `data.sounds.clusters.groups` entry: clusters of one kind,
 * and how often they stand.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const CLUSTER_GROUP_FIELDS = Object.freeze([
    Object.freeze({
        name: "what",
        kind: "string",
        required: true,
        shape: "a string, such as `a nasal and a fricative`",
        describe: "What the clusters of the group are made of.",
    }),
    Object.freeze({
        name: "clusters",
        kind: "list",
        required: true,
        shape: "a list of clusters",
        entries: STRINGS,
        describe: "The clusters, as written; a digraph counts as one consonant.",
    }),
    Object.freeze({
        name: "use",
        kind: "string",
        required: true,
        allowed: CLUSTER_USES,
        shape: `one of ${CLUSTER_USES.join(", ")}`,
        describe: "How often the group's clusters stand inside a word.",
    }),
]);

/**
 * The keys of a language's `data.sounds.clusters`.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const CLUSTER_FIELDS = Object.freeze([
    Object.freeze({
        name: "max",
        kind: "integer",
        required: true,
        shape: "a whole number",
        describe: "The most consonants that stand together inside a word.",
    }),
    Object.freeze({
        name: "groups",
        kind: "list",
        shape: "list of `{ what, clusters, use }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ what, clusters, use }`",
            fields: CLUSTER_GROUP_FIELDS,
        }),
        describe:
            "The clusters that may stand inside a word, in groups; a language stating them " +
            "states no `innerCluster` edge.",
    }),
]);

/**
 * The keys of one `data.sounds.readPast` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const READ_PAST_FIELDS = Object.freeze([
    Object.freeze({
        name: "written",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "A mark or spelling the pages write.",
    }),
    Object.freeze({
        name: "readAs",
        kind: "string",
        shape: "a string",
        describe: "What a word is read with in its place; absent where it is read as nothing.",
    }),
    Object.freeze({
        name: "what",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What the mark or spelling is.",
    }),
]);

/** A list of sounds, or `any` for every one. */
const SOUNDS_OR_ANY = Object.freeze({
    kind: "string-or-list",
    allowed: Object.freeze([ANY_SOUND]),
    shape: `a list of sounds, or \`${ANY_SOUND}\``,
    entries: STRINGS,
});

/**
 * The keys of one `data.sounds.finals` entry: a syllable final, for a
 * language whose syllables are parsed by them.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const FINAL_FIELDS = Object.freeze([
    Object.freeze({
        name: "final",
        kind: "string",
        required: true,
        shape: "a final as written, such as `ang`",
        describe: "The final.",
    }),
    Object.freeze({
        name: "like",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What it sounds like.",
    }),
]);

/**
 * The keys of one `data.sounds.joining` entry: how two parts are written
 * where the first closes and the second opens on the given sounds.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const JOINING_FIELDS = Object.freeze([
    Object.freeze({
        name: "first",
        kind: "list",
        required: true,
        shape: "a list of sounds",
        entries: STRINGS,
        describe: "The sounds the first part closes on.",
    }),
    Object.freeze({
        name: "second",
        kind: "list",
        required: true,
        shape: "a list of sounds",
        entries: STRINGS,
        describe: "The sounds the second part opens on.",
    }),
    Object.freeze({
        name: "written",
        kind: "string",
        required: true,
        shape: "a string, such as `â` or `y+`",
        describe:
            "What is written where they meet: the sound that stands for both, or a join " +
            "closing on `+`, which keeps both and sets it between.",
    }),
    Object.freeze({
        name: "example",
        kind: "string",
        shape: "a string",
        describe: "A word joined so.",
    }),
]);

/**
 * The keys of one `data.sounds.joins` entry: what happens where two parts of a
 * word meet.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const JOIN_FIELDS = Object.freeze([
    Object.freeze({
        name: "meeting",
        kind: "string",
        required: true,
        allowed: JOIN_MEETINGS,
        shape: `one of ${JOIN_MEETINGS.join(", ")}`,
        describe:
            "Which sounds meet: a consonant `C` or a vowel `V` closing the first part, then opening the second.",
    }),
    Object.freeze({
        name: "rule",
        kind: "string",
        required: true,
        allowed: JOIN_RULES,
        shape: `one of ${JOIN_RULES.join(", ")}`,
        describe: "What happens where they meet.",
    }),
    Object.freeze({
        name: "letters",
        kind: "list",
        shape: "a list of letters",
        entries: STRINGS,
        describe:
            "The letters the rule takes: what `insert` sets between, or what `double` doubles.",
    }),
    Object.freeze({
        name: "where",
        kind: "string",
        shape: "a string, such as `between stems`",
        describe: "Where the rule holds; everywhere where absent.",
    }),
]);

/**
 * The keys of one `data.sounds.marks` entry: a mark the language writes on a
 * letter.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const MARK_FIELDS = Object.freeze([
    Object.freeze({
        name: "mark",
        kind: "string",
        required: true,
        shape: "a string, such as `acute`",
        describe: "The mark's name.",
    }),
    Object.freeze({
        name: "letters",
        kind: "list",
        required: true,
        shape: "a list of letters",
        entries: STRINGS,
        describe: "The letters that carry it.",
    }),
    Object.freeze({
        name: "kind",
        kind: "string",
        required: true,
        allowed: MARK_KINDS,
        shape: `one of ${MARK_KINDS.join(", ")}`,
        describe: "What the mark says of its letter.",
    }),
    Object.freeze({
        name: "limit",
        kind: "string",
        required: true,
        allowed: MARK_LIMITS,
        shape: `one of ${MARK_LIMITS.join(", ")}`,
        describe: "How many a word may carry: `one` at most, or `any`.",
    }),
]);

/**
 * The keys of a language's `data.sounds.syllables.harmony`.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const HARMONY_FIELDS = Object.freeze([
    Object.freeze({
        name: "back",
        kind: "list",
        required: true,
        shape: "a list of vowels",
        entries: STRINGS,
        describe: "The back vowels.",
    }),
    Object.freeze({
        name: "front",
        kind: "list",
        required: true,
        shape: "a list of vowels",
        entries: STRINGS,
        describe: "The front vowels.",
    }),
    Object.freeze({
        name: "neutral",
        kind: "list",
        shape: "a list of vowels",
        entries: STRINGS,
        describe: "The vowels of neither set.",
    }),
    Object.freeze({
        name: "neutralAs",
        kind: "string",
        allowed: HARMONY_SETS,
        shape: `one of ${HARMONY_SETS.join(", ")}`,
        describe: "The set a word of neutral vowels alone counts as.",
    }),
    Object.freeze({
        name: "partners",
        kind: "map",
        shape: "a map of vowels to front vowels",
        values: Object.freeze({ kind: "string", shape: "a front vowel" }),
        describe:
            "The front vowel each vowel turns to in an affix's front form, keyed by the vowel; " +
            "every key is a vowel of the harmony and every value one of its `front` vowels.",
    }),
]);

/**
 * The keys of a language's `data.sounds.syllables`: what a syllable may open
 * and close on, and what a word may.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const SYLLABLE_FIELDS = Object.freeze([
    Object.freeze({
        name: "onsets",
        kind: "string",
        allowed: ONSET_RULES,
        shape: `one of ${ONSET_RULES.join(", ")}`,
        describe: "What a syllable opens on: `single`, a single consonant.",
    }),
    Object.freeze({
        name: "codas",
        ...SOUNDS_OR_ANY,
        describe: "The consonants that may close a syllable; `any` for every one.",
    }),
    Object.freeze({
        name: "finals",
        ...SOUNDS_OR_ANY,
        describe: "The consonants that may close a word; `any` for every one.",
    }),
    Object.freeze({
        name: "doubled",
        kind: "list",
        shape: "a list of letters",
        entries: STRINGS,
        describe: "The doubled consonants a word may hold; none where empty.",
    }),
    Object.freeze({
        name: "vowelPairs",
        kind: "list",
        shape: "a list of vowel pairs",
        entries: STRINGS,
        describe: "The vowels that may stand together; none where empty.",
    }),
    Object.freeze({
        name: "initialVowel",
        kind: "boolean",
        shape: "`true` or `false`",
        describe: "Whether a word may open on a vowel.",
    }),
    Object.freeze({
        name: "finalVowel",
        kind: "boolean",
        shape: "`true` or `false`",
        describe: "Whether a word may close on a vowel; `true` where unstated.",
    }),
    Object.freeze({
        name: "neverInitial",
        kind: "list",
        shape: "a list of letters",
        entries: STRINGS,
        describe: "The letters that never open a word.",
    }),
    Object.freeze({
        name: "signature",
        kind: "list",
        shape: "a list of letters",
        entries: STRINGS,
        describe: "The letters that mark a word as the language's own.",
    }),
    Object.freeze({
        name: "harmony",
        kind: "map",
        shape: "a map — `{ back, front, neutral?, neutralAs?, partners? }`",
        fields: HARMONY_FIELDS,
        describe: "The vowel harmony a word keeps.",
    }),
]);

/**
 * The keys of one `data.sounds.skeleton` entry: the vowel set between a
 * root's second and third consonants.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const SKELETON_FIELDS = Object.freeze([
    Object.freeze({
        name: "second",
        ...SOUNDS_OR_ANY,
        required: true,
        describe: "The second consonants of a root the row holds for; `any` for every other.",
    }),
    Object.freeze({
        name: "between",
        kind: "string",
        shape: "a vowel, such as `a`",
        describe: "The vowel set between the second and third consonants; nothing where absent.",
    }),
]);

/**
 * The keys of one `data.sounds.frames` entry: a pattern a root is set in.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const FRAME_FIELDS = Object.freeze([
    Object.freeze({
        name: "frame",
        kind: "string",
        required: true,
        shape: "a string, such as `bare`",
        describe: "The frame's name, which a word's `frame` names.",
    }),
    Object.freeze({
        name: "shape",
        kind: "string",
        required: true,
        shape: "a pattern, such as `K1aK2K3`",
        describe: "The pattern, the root's consonants numbered `K1`, `K2`, `K3`.",
    }),
    Object.freeze({
        name: "class",
        kind: "list",
        required: true,
        shape: "a list of word class bases",
        entries: STRINGS,
        describe: "The classes of word the frame makes, each a base of the master word classes.",
    }),
    Object.freeze({
        name: "makes",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What the frame makes of a root.",
    }),
    Object.freeze({
        name: "examples",
        kind: "map",
        shape: "a map of roots to forms",
        values: Object.freeze({ kind: "string", shape: "a form, bare" }),
        describe: "The form a root takes in the frame, keyed by the root.",
    }),
]);

/**
 * The keys of one `data.sounds.mutations` entry: a sound and what it becomes
 * where a named mutation holds.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const MUTATION_FIELDS = Object.freeze([
    Object.freeze({
        name: "mutation",
        kind: "string",
        required: true,
        shape: "a string, such as `wearing`",
        describe: "The mutation's name; its rows share it, and `data.negation` names it.",
    }),
    Object.freeze({
        name: "sound",
        kind: "string",
        required: true,
        shape: "a sound as written, such as `p`",
        describe: "The sound as it stands where the mutation does not hold; once per mutation.",
    }),
    Object.freeze({
        name: "becomes",
        kind: "string",
        required: true,
        shape: "a sound as written, such as `v`",
        describe: "What the sound becomes where the mutation holds.",
    }),
    Object.freeze({
        name: "example",
        kind: "string",
        shape: "a string",
        describe: "A word that shows it.",
    }),
]);

/**
 * The keys of a language's `data.sounds`.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const SOUND_FIELDS = Object.freeze([
    Object.freeze({
        name: "letters",
        kind: "list",
        shape: "list of `{ letters, kind, like, tongue? }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ letters, kind, like, tongue? }`",
            fields: LETTER_FIELDS,
        }),
        describe: "The letters the language writes, and the sounds they stand for.",
    }),
    Object.freeze({
        name: "edges",
        kind: "list",
        shape: "list of `{ edge, sounds }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ edge, sounds }`",
            fields: EDGE_FIELDS,
        }),
        describe: "The sounds that may stand at each edge of a word, one entry per edge.",
    }),
    Object.freeze({
        name: "clusters",
        kind: "map",
        shape: "a map — `{ max, groups? }`",
        fields: CLUSTER_FIELDS,
        describe: "How many consonants may stand together.",
    }),
    Object.freeze({
        name: "stress",
        kind: "string",
        allowed: STRESS_RULES,
        shape: `one of ${STRESS_RULES.join(", ")}`,
        describe: "Where a word's stress falls.",
    }),
    Object.freeze({
        name: "finals",
        kind: "list",
        shape: "list of `{ final, like }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ final, like }`",
            fields: FINAL_FIELDS,
        }),
        describe: "The syllable finals, for a language whose syllables are parsed by them.",
    }),
    Object.freeze({
        name: "syllables",
        kind: "map",
        shape: "a map of syllable rules",
        fields: SYLLABLE_FIELDS,
        describe: "What a syllable and a word may open and close on.",
    }),
    Object.freeze({
        name: "joining",
        kind: "list",
        shape: "list of `{ first, second, written, example? }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ first, second, written, example? }`",
            fields: JOINING_FIELDS,
        }),
        describe:
            "How two parts are written where the first closes and the second opens on the given sounds.",
    }),
    Object.freeze({
        name: "joins",
        kind: "list",
        shape: "list of `{ meeting, rule, letters?, where? }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ meeting, rule, letters?, where? }`",
            fields: JOIN_FIELDS,
        }),
        describe: "What happens where two parts of a word meet, one entry per meeting.",
    }),
    Object.freeze({
        name: "marks",
        kind: "list",
        shape: "list of `{ mark, letters, kind, limit }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ mark, letters, kind, limit }`",
            fields: MARK_FIELDS,
        }),
        describe: "The marks the language writes on its letters.",
    }),
    Object.freeze({
        name: "skeleton",
        kind: "list",
        shape: "list of `{ second, between? }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ second, between? }`",
            fields: SKELETON_FIELDS,
        }),
        describe: "The vowel set between a root's second and third consonants.",
    }),
    Object.freeze({
        name: "frames",
        kind: "list",
        shape: "list of `{ frame, shape, class, makes, examples? }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ frame, shape, class, makes, examples? }`",
            fields: FRAME_FIELDS,
        }),
        describe: "The patterns a root is set in.",
    }),
    Object.freeze({
        name: "readPast",
        kind: "list",
        shape: "list of `{ written, readAs?, what }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ written, readAs?, what }`",
            fields: READ_PAST_FIELDS,
        }),
        describe: "Marks and spellings a word is read through before the sound rules hold it.",
    }),
    Object.freeze({
        name: "mutations",
        kind: "list",
        shape: "list of `{ mutation, sound, becomes, example? }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ mutation, sound, becomes, example? }`",
            fields: MUTATION_FIELDS,
        }),
        describe:
            "The sounds a word changes where a named mutation holds, one entry per sound, such " +
            "as a stop worn to a fricative or a consonant voiced inside a compound.",
    }),
]);

/**
 * The keys of one `data.soundChanges` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const SOUND_CHANGE_STEP_FIELDS = Object.freeze([
    Object.freeze({
        name: "step",
        kind: "string",
        required: true,
        shape: 'a string, such as `A1` or `"1"`',
        describe: "The step's label, in the order the changes apply.",
    }),
    Object.freeze({
        name: "change",
        kind: "string",
        required: true,
        shape: "a change in arrow notation, such as `` `ph` > `f`; `kh` > `h` ``",
        describe:
            "The change, in arrow notation: one or more `` `sources` > `targets` `` rules " +
            "separated by `;`, or the operation a step names in words.",
    }),
    Object.freeze({
        name: "where",
        kind: "string",
        shape: "a string, such as `word end`",
        describe: "Where the change holds; everywhere where absent.",
    }),
]);

/**
 * The keys of one `data.soundChanges` set: an ordered run of steps, named, and
 * where they lead from and to.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const SOUND_CHANGE_FIELDS = Object.freeze([
    Object.freeze({
        name: "name",
        kind: "string",
        required: true,
        shape: "a string, such as `From Helonic to Byzarian`",
        describe: "The set's name, which no other set of the note shares.",
    }),
    Object.freeze({
        name: "from",
        kind: "address",
        shape: "a language skill Address",
        describe: "The language whose words the steps start from.",
    }),
    Object.freeze({
        name: "to",
        kind: "address",
        shape: "a language skill Address",
        describe: "The language whose words the steps make.",
    }),
    Object.freeze({
        name: "takes",
        kind: "string",
        shape: "a case, such as `accusative`",
        describe:
            "The form of the older word the steps start from; its citation form where absent.",
    }),
    Object.freeze({
        name: "steps",
        kind: "list",
        required: true,
        shape: "list of `{ step, change, where? }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ step, change, where? }`",
            fields: SOUND_CHANGE_STEP_FIELDS,
        }),
        describe: "The steps, in the order they apply; no step label stands twice in a set.",
    }),
]);

/**
 * The keys of one `data.elements` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const ELEMENT_FIELDS = Object.freeze([
    Object.freeze({
        name: "form",
        kind: "string",
        required: true,
        shape: "the element as written, such as `arn-`",
        describe: "The element a name is built from.",
    }),
    Object.freeze({
        name: "variants",
        kind: "list",
        shape: "a list of forms",
        entries: STRINGS,
        describe: "The element's other forms, such as `aldr-` beside `ald-`.",
    }),
    Object.freeze({
        name: "position",
        kind: "string",
        allowed: ELEMENT_POSITIONS,
        shape: `one of ${ELEMENT_POSITIONS.join(", ")}`,
        describe: "Where in a name the element stands.",
    }),
    Object.freeze({
        name: "kind",
        kind: "string",
        allowed: REGISTER_KINDS,
        shape: `one of ${REGISTER_KINDS.join(", ")}`,
        describe:
            "The kind of name the element builds, in a language that keeps one set of elements " +
            "per kind; every kind where absent.",
    }),
    Object.freeze({
        name: "sense",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What the element means.",
    }),
    Object.freeze({
        name: "examples",
        kind: "list",
        shape: "a list of names",
        entries: STRINGS,
        describe: "The names the element is read from.",
    }),
    Object.freeze({
        name: "word",
        kind: "string",
        shape: "a form of the language's words",
        describe:
            "The word the element is the stem of, a form of `data.words` of the language or an " +
            "ancestor.",
    }),
    Object.freeze({
        name: "joining",
        kind: "string",
        shape: "the element as written, such as `-borgar`",
        describe: "The element's joining form, as written when it qualifies another word.",
    }),
]);

/**
 * The keys of one `data.roots` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const ROOT_FIELDS = Object.freeze([
    Object.freeze({
        name: "root",
        kind: "string",
        required: true,
        shape: "a consonantal skeleton, such as `d-l-k`",
        describe: "The root.",
    }),
    Object.freeze({
        name: "sense",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What the root means.",
    }),
    Object.freeze({
        name: "field",
        kind: "string",
        shape: "a string, such as `stone`",
        describe: "The field the root belongs to.",
    }),
]);

/**
 * The keys of one `data.cognates` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const COGNATE_FIELDS = Object.freeze([
    Object.freeze({
        name: "forms",
        kind: "map",
        required: true,
        shape: "a map of language Addresses to forms",
        values: Object.freeze({ kind: "string", shape: "a form, bare" }),
        describe: "The form the set takes in each language, keyed by the language note's Address.",
    }),
    Object.freeze({
        name: "proto",
        kind: "string",
        shape: "a form, bare",
        describe:
            "The reconstructed form the set descends from, in no attested language; printed with " +
            "an asterisk.",
    }),
    Object.freeze({
        name: "gloss",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What the forms mean.",
    }),
]);

/**
 * The keys of one `data.callingNames.closings` entry: an ending, or the first
 * syllable doubled, that a calling name closes on.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const CALLING_CLOSING_FIELDS = Object.freeze([
    Object.freeze({
        name: "form",
        kind: "string",
        shape: "an ending, such as `-u`",
        describe: "The ending; a row states `form` or `doubled`, never both.",
    }),
    Object.freeze({
        name: "doubled",
        kind: "boolean",
        shape: "`true`",
        describe: "The calling name doubles the first syllable rather than taking an ending.",
    }),
    Object.freeze({
        name: "usual",
        kind: "string",
        required: true,
        allowed: CALLING_USES,
        shape: `one of ${CALLING_USES.join(", ")}`,
        describe: "Whose name it usually makes.",
    }),
]);

/**
 * The keys of a language's `data.callingNames`: the short name a long given
 * name is called by.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const CALLING_NAME_FIELDS = Object.freeze([
    Object.freeze({
        name: "closings",
        kind: "list",
        required: true,
        shape: "list of `{ form?, doubled?, usual }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ form?, doubled?, usual }`",
            fields: CALLING_CLOSING_FIELDS,
        }),
        describe: "What a calling name closes on.",
    }),
    Object.freeze({
        name: "minSyllables",
        kind: "integer",
        required: true,
        shape: "a whole number",
        describe: "The fewest syllables a given name has that the pages give a calling name.",
    }),
]);

/**
 * The keys of one `data.older` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const OLDER_FIELDS = Object.freeze([
    Object.freeze({
        name: "form",
        kind: "string",
        required: true,
        shape: "a form as the setting writes it",
        describe: "A word or name whose shape the language's rules do not make.",
    }),
    Object.freeze({
        name: "gloss",
        kind: "string",
        shape: "a string",
        describe: "What it means.",
    }),
    Object.freeze({
        name: "layer",
        kind: "string",
        shape: "a string, such as `Primordial`",
        describe: "The historical layer it belongs to.",
    }),
]);

/**
 * The keys of a language's `data.negation`.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const NEGATION_FIELDS = Object.freeze([
    Object.freeze({
        name: "particle",
        kind: "string",
        required: true,
        shape: "a form of the language's words",
        describe:
            "The particle that stands before a verb to negate it, a form of `data.words` of the " +
            "language or an ancestor.",
    }),
    Object.freeze({
        name: "mutation",
        kind: "string",
        shape: "a mutation of `data.sounds.mutations`",
        describe: "The mutation the negated verb takes, named in `data.sounds.mutations`.",
    }),
]);

/**
 * The keys of a range: the least and the most.
 *
 * @param {string} kind - `integer` or `number`.
 * @param {string} what - What the range counts.
 * @returns {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
const rangeFields = (kind, what) =>
    Object.freeze([
        Object.freeze({
            name: "min",
            kind,
            required: true,
            shape: kind === "integer" ? "a whole number" : "a number",
            describe: `The fewest ${what}.`,
        }),
        Object.freeze({
            name: "max",
            kind,
            required: true,
            shape: kind === "integer" ? "a whole number" : "a number",
            describe: `The most ${what}; never below \`min\`.`,
        }),
    ]);

/**
 * The keys of one `data.naming.shapes` entry: how long a class of name runs.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const NAME_SHAPE_FIELDS = Object.freeze([
    Object.freeze({
        name: "of",
        kind: "string",
        required: true,
        allowed: NAME_CLASSES,
        shape: `one of ${NAME_CLASSES.join(", ")}`,
        describe: "The class of name the shape holds for; once per class.",
    }),
    Object.freeze({
        name: "syllables",
        kind: "map",
        shape: "a map — `{ min, max }`",
        fields: rangeFields("integer", "syllables a name of the class runs to"),
        describe: "How many syllables a name of the class runs to.",
    }),
    Object.freeze({
        name: "perVowel",
        kind: "map",
        shape: "a map — `{ min, max }`",
        fields: rangeFields("number", "consonants a name of the class carries to each vowel"),
        describe:
            "How many consonants a name of the class carries to each vowel; a shape states this, " +
            "`syllables`, or both.",
    }),
]);

/**
 * The keys of one `data.naming.edges` entry: the sounds a name may open or
 * close on, where a name keeps edges ordinary words do not.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const NAME_EDGE_FIELDS = Object.freeze([
    Object.freeze({
        name: "edge",
        kind: "string",
        required: true,
        allowed: EDGE_KINDS,
        shape: `one of ${EDGE_KINDS.join(", ")}`,
        describe: "Which edge of a name the sounds stand at.",
    }),
    Object.freeze({
        name: "sounds",
        kind: "string-or-list",
        required: true,
        allowed: Object.freeze([ANY_SOUND]),
        shape: `a list of sounds, or \`${ANY_SOUND}\``,
        entries: STRINGS,
        describe: `The sounds, as written; \`${ANY_SOUND}\` for every one, and an empty list for none.`,
    }),
    Object.freeze({
        name: "vowel",
        kind: "boolean",
        shape: "`true` or `false`",
        describe: "Whether a vowel may stand at the edge too; `false` where unstated.",
    }),
    Object.freeze({
        name: "of",
        kind: "string",
        allowed: NAME_CLASSES,
        shape: `one of ${NAME_CLASSES.join(", ")}`,
        describe: `The class of name the edge holds for; \`${ANY_NAME}\`, every name, where absent.`,
    }),
]);

/**
 * The keys of one `data.naming.draws` entry: the element kinds a kind of name
 * is built from.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const NAME_DRAW_FIELDS = Object.freeze([
    Object.freeze({
        name: "kind",
        kind: "string",
        required: true,
        allowed: REGISTER_KINDS,
        shape: `one of ${REGISTER_KINDS.join(", ")}`,
        describe: "The kind of name; once per kind.",
    }),
    Object.freeze({
        name: "elements",
        kind: "list",
        required: true,
        shape: "a list of element kinds",
        entries: Object.freeze({
            kind: "string",
            allowed: REGISTER_KINDS,
            shape: `one of ${REGISTER_KINDS.join(", ")}`,
        }),
        describe: "The kinds of element, as `data.elements` states them, the name is built from.",
    }),
]);

/**
 * The keys of one `data.naming.heldFrom` entry: what a place name takes first
 * from what the place is held from.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const HELD_FROM_FIELDS = Object.freeze([
    Object.freeze({
        name: "source",
        kind: "string",
        required: true,
        shape: "a string, such as `a founder`",
        describe: "What the place is held from.",
    }),
    Object.freeze({
        name: "takes",
        kind: "string",
        required: true,
        allowed: HELD_TAKES,
        shape: `one of ${HELD_TAKES.join(", ")}`,
        describe:
            "What stands first: a name-stem in any grade, a god's name, a founder's given name, " +
            "or one of `elements`.",
    }),
    Object.freeze({
        name: "clip",
        kind: "string",
        allowed: HELD_CLIPS,
        shape: `one of ${HELD_CLIPS.join(", ")}`,
        describe: "How the name is clipped: `first`, to its first element; whole where absent.",
    }),
    Object.freeze({
        name: "joining",
        kind: "list",
        shape: "a list of endings",
        entries: STRINGS,
        describe: "The joining endings, one of which stands at the seam after the name.",
    }),
    Object.freeze({
        name: "elements",
        kind: "list",
        shape: "a list of elements",
        entries: STRINGS,
        describe: "The elements that may stand first, for a row that takes an `element`.",
    }),
]);

/**
 * The keys of one `data.naming.nearName.examples` entry.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const NEAR_NAME_EXAMPLE_FIELDS = Object.freeze([
    Object.freeze({
        name: "near",
        kind: "string",
        required: true,
        shape: "a near name, such as `Anlâ`",
        describe: "The near name.",
    }),
    Object.freeze({
        name: "given",
        kind: "string",
        required: true,
        shape: "a given name",
        describe: "The given name it is the near name of.",
    }),
]);

/**
 * The keys of a language's `data.naming.nearName`.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const NEAR_NAME_FIELDS = Object.freeze([
    Object.freeze({
        name: "minSyllables",
        kind: "integer",
        required: true,
        shape: "a whole number",
        describe: "The fewest syllables a given name has that carries a near name.",
    }),
    Object.freeze({
        name: "examples",
        kind: "list",
        shape: "list of `{ near, given }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ near, given }`",
            fields: NEAR_NAME_EXAMPLE_FIELDS,
        }),
        describe: "Worked near names, each beside its given name.",
    }),
]);

/** A list of maps, as an inner key's declaration. */
const innerList = (name, fields, describe) => {
    const keys = fields.map((field) => (field.required ? field.name : `${field.name}?`)).join(", ");
    return Object.freeze({
        name,
        kind: "list",
        shape: `list of \`{ ${keys} }\``,
        entries: Object.freeze({ kind: "map", shape: `a map — \`{ ${keys} }\``, fields }),
        describe,
    });
};

/**
 * The keys of a language's `data.naming`: the parameters its names keep
 * beyond the rules its words keep.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const NAMING_FIELDS = Object.freeze([
    innerList("shapes", NAME_SHAPE_FIELDS, "How long each class of name runs."),
    innerList(
        "edges",
        NAME_EDGE_FIELDS,
        "The sounds a name may open and close on, where names keep edges ordinary words do not; " +
            "an edge stands once for each class of name.",
    ),
    innerList("draws", NAME_DRAW_FIELDS, "The element kinds each kind of name is built from."),
    innerList(
        "heldFrom",
        HELD_FROM_FIELDS,
        "What a place name takes first, by what the place is held from.",
    ),
    Object.freeze({
        name: "nearName",
        kind: "map",
        shape: "a map — `{ minSyllables, examples? }`",
        fields: NEAR_NAME_FIELDS,
        describe: "The near name a long given name carries.",
    }),
]);

/**
 * A list of maps, as a `data` field's declaration.
 *
 * @param {string} name - The key.
 * @param {readonly import("./data-keys.mjs").InnerKeySpec[]} fields - One entry's keys.
 * @param {string} describe - What the list holds.
 * @returns {object} The declaration.
 */
function listOfMaps(name, fields, describe) {
    const keys = fields.map((field) => (field.required ? field.name : `${field.name}?`)).join(", ");
    return Object.freeze({
        name,
        kind: "list",
        shape: `list of \`{ ${keys} }\``,
        entries: Object.freeze({ kind: "map", shape: `a map — \`{ ${keys} }\``, fields }),
        describe: `${describe} A language skill note only.`,
    });
}

/**
 * The six present persons of the one optional regular verb pattern, in
 * presentation order. Empty endings leave the citation form unchanged.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const VERB_PERSON_FIELDS = Object.freeze(
    [
        ["I", "I"],
        ["you", "you"],
        ["heShe", "he/she"],
        ["we", "we"],
        ["youAll", "you all"],
        ["they", "they"],
    ].map(([name, label]) =>
        Object.freeze({
            name,
            label,
            kind: "string",
            required: true,
            allowEmpty: true,
            shape: "an ending string, empty for unchanged",
            describe: `The ending added to the citation form for ${label}.`,
        }),
    ),
);

/** The two alternatives of a supplied optional verb pattern. */
const VERB_PATTERN_FIELDS = Object.freeze([
    Object.freeze({
        name: "invariant",
        kind: "boolean",
        shape: "true, as the alternative to persons",
        describe: "True where verbs keep the citation form for every person; excludes `persons`.",
    }),
    Object.freeze({
        name: "persons",
        kind: "map",
        shape: "a map — `{ I, you, heShe, we, youAll, they }` of ending strings",
        fields: VERB_PERSON_FIELDS,
        describe: "All six present endings, each added to the citation form; excludes `invariant`.",
    }),
]);

/** The optional, display-only noun and verb patterns of one language. */
const GRAMMAR_FIELDS = Object.freeze([
    innerList(
        "plural",
        Object.freeze(
            ["ending", "becomes"].map((name) =>
                Object.freeze({
                    name,
                    kind: "string",
                    required: true,
                    allowEmpty: true,
                    shape: "a literal ending string, which may be empty",
                    describe:
                        name === "ending" ?
                            "The bare suffix replaced by this rule; empty matches every noun."
                        :   "The bare replacement; empty removes the matching suffix.",
                }),
            ),
        ),
        "Default noun plurals, replacing the first matching literal ending in authored order. " +
            "A word's explicit plural wins; no word is checked against this rule.",
    ),
    Object.freeze({
        name: "verbs",
        kind: "map",
        shape: "a map — `{ invariant: true }` or `{ persons: { I, you, heShe, we, youAll, they } }`",
        fields: VERB_PATTERN_FIELDS,
        describe: "One optional regular present pattern, printed once at the dictionary head.",
    }),
]);

/**
 * The `data` fields this module declares, in the order the vocabulary lists
 * them. {@link module:engine/language-data.checkLanguageData} checks what the
 * values mean.
 *
 * @type {readonly object[]}
 */
export const LANGUAGE_DATA_FIELDS = Object.freeze([
    Object.freeze({
        name: "grammar",
        kind: "map",
        shape: "a map — `{ plural?, verbs? }`",
        fields: GRAMMAR_FIELDS,
        describe:
            "Optional noun plurals and one verb pattern for dictionary presentation. Only the " +
            "shape of supplied keys is checked; no word must follow or state a rule. A language " +
            "skill note only.",
    }),
    listOfMaps(
        "tongues",
        TONGUE_FIELDS,
        "The tags a register row's `tongue` may name, each with what it means.",
    ),
    listOfMaps(
        "register",
        REGISTER_FIELDS,
        "Every name the setting gives in the language's reach, with its tongue and pieces; the " +
            "notes carrying each name are derived.",
    ),
    listOfMaps("retired", RETIRED_FIELDS, "The forms the setting does not write, and why."),
    Object.freeze({
        name: "scope",
        kind: "map",
        shape: "a map — `{ folders?, cultures?, lore?, parents?, addresses?, paths?, types?, skip? }`",
        fields: SCOPE_FIELDS,
        describe: "The notes the register covers. A language skill note only.",
    }),
    Object.freeze({
        name: "sounds",
        kind: "map",
        shape:
            "a map — `{ letters?, edges?, clusters?, stress?, finals?, syllables?, joining?, " +
            "joins?, marks?, skeleton?, frames?, readPast?, mutations? }`",
        fields: SOUND_FIELDS,
        describe:
            "The letters the language writes and the rules its words keep. A language skill " +
            "note only.",
    }),
    listOfMaps(
        "soundChanges",
        SOUND_CHANGE_FIELDS,
        "Named sets of ordered changes, each making one tongue's words from another's.",
    ),
    listOfMaps("elements", ELEMENT_FIELDS, "The elements the language's names are built from."),
    listOfMaps("roots", ROOT_FIELDS, "The consonantal roots the language's words are set from."),
    listOfMaps(
        "cognates",
        COGNATE_FIELDS,
        "Sets of forms one older word takes in several languages, stated on the eldest.",
    ),
    Object.freeze({
        name: "callingNames",
        kind: "map",
        shape: "a map — `{ closings, minSyllables }`",
        fields: CALLING_NAME_FIELDS,
        describe: "The short name a long given name is called by. A language skill note only.",
    }),
    listOfMaps(
        "older",
        OLDER_FIELDS,
        "The words and names older than the language's rules, which no sound or name rule holds.",
    ),
    Object.freeze({
        name: "negation",
        kind: "map",
        shape: "a map — `{ particle, mutation? }`",
        fields: NEGATION_FIELDS,
        describe: "How a verb is negated. A language skill note only.",
    }),
    Object.freeze({
        name: "naming",
        kind: "map",
        shape: "a map — `{ shapes?, edges?, draws?, heldFrom?, nearName? }`",
        fields: NAMING_FIELDS,
        describe:
            "The shapes, edges and sources the language's names keep beyond its words' rules. A " +
            "language skill note only.",
    }),
]);

/** The keys of {@link TONGUE_FIELDS}, in declared order. */
export const TONGUE_KEYS = Object.freeze(TONGUE_FIELDS.map((field) => field.name));
/** The keys of {@link REGISTER_FIELDS}, in declared order. */
export const REGISTER_KEYS = Object.freeze(REGISTER_FIELDS.map((field) => field.name));
/** The keys of {@link RETIRED_FIELDS}, in declared order. */
export const RETIRED_KEYS = Object.freeze(RETIRED_FIELDS.map((field) => field.name));
/** The keys of {@link LETTER_FIELDS}, in declared order. */
export const LETTER_KEYS = Object.freeze(LETTER_FIELDS.map((field) => field.name));
/** The keys of {@link EDGE_FIELDS}, in declared order. */
export const EDGE_KEYS = Object.freeze(EDGE_FIELDS.map((field) => field.name));
/** The keys of {@link READ_PAST_FIELDS}, in declared order. */
export const READ_PAST_KEYS = Object.freeze(READ_PAST_FIELDS.map((field) => field.name));
/** The keys of {@link SOUND_CHANGE_STEP_FIELDS}, in declared order. */
export const SOUND_CHANGE_STEP_KEYS = Object.freeze(
    SOUND_CHANGE_STEP_FIELDS.map((field) => field.name),
);
/** The keys of {@link FINAL_FIELDS}, in declared order. */
export const FINAL_KEYS = Object.freeze(FINAL_FIELDS.map((field) => field.name));
/** The keys of {@link JOINING_FIELDS}, in declared order. */
export const JOINING_KEYS = Object.freeze(JOINING_FIELDS.map((field) => field.name));
/** The keys of {@link JOIN_FIELDS}, in declared order. */
export const JOIN_KEYS = Object.freeze(JOIN_FIELDS.map((field) => field.name));
/** The keys of {@link MARK_FIELDS}, in declared order. */
export const MARK_KEYS = Object.freeze(MARK_FIELDS.map((field) => field.name));
/** The keys of {@link SKELETON_FIELDS}, in declared order. */
export const SKELETON_KEYS = Object.freeze(SKELETON_FIELDS.map((field) => field.name));
/** The keys of {@link CALLING_CLOSING_FIELDS}, in declared order. */
export const CALLING_CLOSING_KEYS = Object.freeze(
    CALLING_CLOSING_FIELDS.map((field) => field.name),
);
/** The keys of {@link ELEMENT_FIELDS}, in declared order. */
export const ELEMENT_KEYS = Object.freeze(ELEMENT_FIELDS.map((field) => field.name));
/** The keys of {@link ROOT_FIELDS}, in declared order. */
export const ROOT_KEYS = Object.freeze(ROOT_FIELDS.map((field) => field.name));
/** The keys of {@link MUTATION_FIELDS}, in declared order. */
export const MUTATION_KEYS = Object.freeze(MUTATION_FIELDS.map((field) => field.name));
/** The keys of {@link CLUSTER_GROUP_FIELDS}, in declared order. */
export const CLUSTER_GROUP_KEYS = Object.freeze(CLUSTER_GROUP_FIELDS.map((field) => field.name));
/** The keys of {@link OLDER_FIELDS}, in declared order. */
export const OLDER_KEYS = Object.freeze(OLDER_FIELDS.map((field) => field.name));
/** The keys of {@link SCOPE_FIELDS}, in declared order. */
export const SCOPE_KINDS = Object.freeze(SCOPE_FIELDS.map((field) => field.name));
