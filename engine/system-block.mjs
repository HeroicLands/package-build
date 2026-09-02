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
 * **The per-system frontmatter block** — how one note feeds more than one game
 * system (#58).
 *
 * A note is system-agnostic. The only system-specific things it carries are the
 * properties *named after a system*, and within one:
 *
 * | property | maps to |
 * | --- | --- |
 * | `<system>.system` | `document.system` — the DataModel schema, verbatim paths |
 * | `<system>.type` | `document.type` — the subtype (#79's discriminator) |
 * | `<system>.img` | `document.img` |
 * | `<system>.items` | `document.items` — actors only |
 * | `<system>.effects` | `document.effects` |
 * | `<system>.flags` | `document.flags` |
 * | `<system>.pack` | *nothing on the document* — a build directive naming the compendium |
 *
 * Everything else a system declares — `archetype`, `kbcat`, and the
 * *generators* `items` and `attributes`, which expand into embedded documents
 * rather than mapping anywhere — sits directly under the block, which is why it
 * has to be somewhere the schema cannot claim.
 *
 * ## The shared fallback is declared, not name-matched
 *
 * This is the load-bearing part, and the reason the whole module exists.
 * `sohl.system.portrait` and `hm3.system.bioImage` both default from one shared
 * top-level property — and they are two *real* fields with different names. The
 * two Actor schemas one `being` note has to feed share **no field name at all**,
 * so a rule that matched on spelling would not be a rule with exceptions; it
 * would be a rule that never fires.
 *
 * So each field declares where its shared value comes from, and the resolution
 * order for a system `S` is:
 *
 * 1. `S.system.<to>` — authored directly, wins outright;
 * 2. `S.<name>` — the legacy in-block position the corpus still writes, kept
 *    until #126 moves it;
 * 3. the shared top-level property the field **declares** as its source, which
 *    may be a dotted path (`data.portrait`) rather than a sibling key;
 * 4. the field's own default.
 *
 * `sohlField()` — read `fm.sohl[key]`, fall back to `fm[key]` — is the
 * degenerate case where source and destination happen to share a name. It stops
 * being the general rule; {@link blockField} is what remains of it.
 *
 * ## Nothing here knows a game system
 *
 * A block is addressed by name, and the name arrives from the caller — a
 * system's own document-subtype map declares it (`DocumentSubtypeMap.block`).
 * That is the `engine/` ÷ `sohl/` line this package draws everywhere else
 * (#36): note-format knowledge here, game-system knowledge in the system's own
 * half.
 *
 * @module
 */

import { getFrontmatter } from "./frontmatter.mjs";

/**
 * The key inside a system block that maps onto the document's `system`
 * property.
 *
 * Named rather than spelled inline: it is the one key whose contents are the
 * *system's* vocabulary rather than this format's, and every check that has to
 * treat it differently reads it from here.
 *
 * @type {string}
 */
export const SYSTEM_DATA_KEY = "system";

/**
 * The properties inside a system block that map onto a document property, block
 * key → document key.
 *
 * The two names are equal in every row today, and are written out anyway for
 * the reason every row of a document-subtype map is: a mapping that exists only
 * because two vocabularies happen to be spelled alike is not a mapping.
 *
 * `effects` is **plural**, matching both the existing top-level frontmatter
 * field (authored on 24 notes in `sohl-kethira-basic`) and the Foundry document
 * property. A singular-to-plural rename applying to one property and not its
 * neighbour reads as a typo for years.
 *
 * `items` exists on **actors only**; an item document has no embedded items,
 * and a note declaring it under a block whose subtype is an Item is authoring
 * something nothing will read.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const BLOCK_DOCUMENT_PROPERTIES = Object.freeze({
    system: "system",
    type: "type",
    img: "img",
    items: "items",
    effects: "effects",
    flags: "flags",
});

/**
 * Block keys that are **build directives** — they tell the toolchain how to
 * build the document and land on no document property at all.
 *
 * `pack` is the first and, so far, the only one: it names the compendium this
 * system's document is compiled into, which is what makes "one note, several
 * packs" expressible per system. Its shared top-level form already exists
 * (`PACK_FIELD` in `pack-router.mjs`, authored on 352 notes), so the override
 * rule gives it a per-system form for free.
 *
 * @type {readonly string[]}
 */
export const BLOCK_DIRECTIVES = Object.freeze(["pack"]);

/**
 * Every key any system block may carry, whatever the system.
 *
 * A system adds its own on top — `archetype`, `kbcat` and the generators — and
 * names them where it declares its vocabulary; see {@link unknownBlockKeys}.
 *
 * @type {ReadonlySet<string>}
 */
export const SYSTEM_BLOCK_KEYS = Object.freeze(
    new Set([...Object.keys(BLOCK_DOCUMENT_PROPERTIES), ...BLOCK_DIRECTIVES]),
);

/**
 * Write `value` at a dotted path in a document's `system` block, creating the
 * intermediate objects.
 *
 * Insertion order is the emitted JSON's key order, so a declaration's order is
 * the compiled document's order — which is what lets a field list replace a
 * hand-written object literal without changing a single byte of output.
 *
 * It sits here rather than beside the field declarations because both writers
 * into a `system` block use it: the declared fields, and the verbatim
 * `<system>.system` passthrough. `field-spec.mjs` re-exports it, so the name
 * has one import path as well as one definition.
 *
 * @param {object} target - The object to write into (mutated).
 * @param {string} dotted - Path, e.g. `"locations.flexible"`.
 * @param {any} value - The value to set.
 * @returns {object} `target`, for chaining.
 */
export function setPath(target, dotted, value) {
    const parts = dotted.split(".");
    const leaf = /** @type {string} */ (parts.pop());
    let cursor = target;
    for (const part of parts) {
        if (
            cursor[part] == null ||
            typeof cursor[part] !== "object" ||
            Array.isArray(cursor[part])
        ) {
            cursor[part] = {};
        }
        cursor = cursor[part];
    }
    cursor[leaf] = value;
    return target;
}

/**
 * Whether a value is a plain object — a mapping, not an array and not `null`.
 *
 * @param {unknown} value - The value.
 * @returns {boolean} True for a mapping.
 */
function isMapping(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * One system's block, or nothing.
 *
 * A block authored as a scalar or a list is **absent** rather than an error
 * here: this module reports what a note carries, and saying what is wrong with
 * a malformed one is the linter's job, which can point at the line.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - The block key, e.g. `"sohl"`.
 * @returns {Record<string, unknown>|undefined} The block, or `undefined`.
 */
export function systemBlock(fm, block) {
    if (!isMapping(fm) || !block) return undefined;
    const value = /** @type {Record<string, unknown>} */ (fm)[block];
    return isMapping(value) ? /** @type {Record<string, unknown>} */ (value) : undefined;
}

/**
 * Whether a note carries a system's block at all.
 *
 * This is the pack-eligibility question: a pack declaring a system compiles a
 * note only if the note has something to say about that system. A note that
 * does not carries no system data, and compiling it anyway produces a hollow
 * document — one with a subtype and none of the fields that subtype exists for.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - The block key.
 * @returns {boolean} True when the block is present and is a mapping.
 */
export function carriesSystemBlock(fm, block) {
    return systemBlock(fm, block) !== undefined;
}

/**
 * A system block's `system` sub-block — what maps onto `document.system`.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - The block key.
 * @returns {Record<string, unknown>} The authored data, `{}` when absent.
 */
export function systemData(fm, block) {
    const value = systemBlock(fm, block)?.[SYSTEM_DATA_KEY];
    return isMapping(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * Read a key from one system's block, falling back to the top level.
 *
 * The generalization of `sohlField()` to any block, and behaviourally identical
 * to it for `"sohl"` — the one system every existing tree authors. What changed
 * is that the block is a parameter rather than a constant, which is the whole
 * of what a second system needs from this reader.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - The block key.
 * @param {string} key - The property, dotted for a nested one.
 * @param {any} [defaultValue] - Returned when neither declares it.
 * @returns {any} The value.
 */
export function blockField(fm, block, key, defaultValue = undefined) {
    if (!isMapping(fm)) return defaultValue;
    const declared = systemBlock(fm, block);
    if (declared) {
        if (key in declared) return declared[key] ?? defaultValue;
        const fromNested = getFrontmatter(declared, key, undefined);
        if (fromNested !== undefined) return fromNested;
    }
    return getFrontmatter(fm, key, defaultValue);
}

/**
 * A **shared** top-level property, read by a possibly-dotted path.
 *
 * Deliberately blind to every system block: this is the third step of the
 * resolution order, and letting a block answer it would make the second step
 * and the third the same question.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} source - The property, dotted for a path into a container.
 * @param {any} [defaultValue] - Returned when the path resolves to nothing.
 * @returns {any} The value.
 */
export function sharedProperty(fm, source, defaultValue = undefined) {
    return getFrontmatter(fm, source, defaultValue);
}

/**
 * A property a system block may override, else the shared top-level one.
 *
 * This is what gives `pack`, `effects`, `flags` and `img` their per-system form
 * without inventing a mechanism for each: a note that wants one value for both
 * systems says it once at the top, and a note that needs them to differ says so
 * in the block that differs.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - The block key.
 * @param {string} key - The property.
 * @param {any} [defaultValue] - Returned when neither declares it.
 * @returns {any} The value.
 */
export function blockProperty(fm, block, key, defaultValue = undefined) {
    const declared = systemBlock(fm, block);
    if (declared && declared[key] !== undefined && declared[key] !== null) {
        return declared[key];
    }
    const shared = isMapping(fm) ? /** @type {Record<string, unknown>} */ (fm)[key] : undefined;
    return shared === undefined || shared === null ? defaultValue : shared;
}

/**
 * Where a declared field's value came from.
 *
 * Reported alongside the value so a caller — a linter, a migration, a test —
 * can distinguish a value an author wrote from one a default supplied, which
 * the value alone never says.
 *
 * @typedef {"system"|"block"|"shared"|"default"|"value"} FieldSource
 */

/**
 * Resolve one declared field against a note, in the declared order.
 *
 * See the module note for the order and why it is declared rather than
 * name-matched. The value comes back **raw**; applying the field's own `read`
 * is {@link module:engine/field-spec.readField}'s job, and it applies the same
 * coercion wherever the value was authored.
 *
 * @param {import("./field-spec.mjs").FieldSpec} field - The declaration.
 * @param {object} fm - The note's frontmatter.
 * @param {object} [options] - Options.
 * @param {string} [options.block="sohl"] - The system block to resolve against.
 * @returns {{value: any, from: FieldSource}} The raw value and where it came
 *   from.
 */
export function resolveFieldValue(field, fm, { block = "sohl" } = {}) {
    // A field with no shared source is a constant or a derived value — it is
    // not authored anywhere, so no position can answer for it.
    if (field.name === undefined) {
        return {
            value: typeof field.value === "function" ? field.value(fm) : field.value,
            from: "value",
        };
    }

    // 1. Authored directly at the destination path, in this system's own data.
    //    A declaration with no `to` has no destination to author, so there is
    //    nothing to look for — every emitted field has one, but the field lists
    //    a linter is handed do not all describe emitted fields.
    if (typeof field.to === "string" && field.to !== "") {
        const own = getFrontmatter(systemData(fm, block), field.to, undefined);
        if (own !== undefined) return { value: own, from: "system" };
    }

    // 2. The legacy in-block position. Every note in every tree writes here
    //    today, and will until #126 moves them; dropping it would be a corpus
    //    migration disguised as a mechanism change.
    const declared = systemBlock(fm, block);
    if (declared) {
        if (field.name in declared) {
            const value = declared[field.name];
            return { value: value ?? field.default, from: "block" };
        }
        const nested = getFrontmatter(declared, field.name, undefined);
        if (nested !== undefined) return { value: nested, from: "block" };
    }

    // 3. The shared property this field declares as its source.
    const shared = getFrontmatter(fm, field.name, undefined);
    if (shared !== undefined) return { value: shared, from: "shared" };

    // 4. The field's own default.
    return { value: field.default, from: "default" };
}

/**
 * Every path a note authors under `<system>.system`, containers included.
 *
 * A container is listed as well as its leaves because a published schema
 * declares both — `charges` as a `SchemaField` and `charges.value` beneath it —
 * so a check that knew only the leaves could not tell a misspelled container
 * from a misspelled leaf.
 *
 * An **empty** mapping is a leaf: `body: {}` is a value the author wrote, and
 * walking into it would make it vanish.
 *
 * @param {Record<string, unknown>} data - The authored `system` data.
 * @param {string} [prefix] - Internal: the path so far.
 * @returns {string[]} The dotted paths.
 */
export function systemDataPaths(data, prefix = "") {
    const out = [];
    if (!isMapping(data)) return out;
    for (const [key, value] of Object.entries(data)) {
        const path = prefix ? `${prefix}.${key}` : key;
        out.push(path);
        if (isMapping(value) && Object.keys(value).length) {
            out.push(...systemDataPaths(/** @type {Record<string, unknown>} */ (value), path));
        }
    }
    return out;
}

/**
 * The authored paths a system's published schema does not declare.
 *
 * **Reported at the shallowest undeclared path.** Everything beneath an
 * undeclared container is undeclared by construction, so listing it all buries
 * the one mistake in a wall of consequences — one finding per typo is what an
 * author can act on.
 *
 * Foundry discards an unknown `system` key at construction and says nothing, so
 * this is the difference between "the field is lost at load" and "the build
 * told you where".
 *
 * @param {Record<string, unknown>} data - The authored `system` data.
 * @param {ReadonlySet<string>} declared - Every field path the schema declares
 *   for this subtype, inherited ones included.
 * @param {string} [prefix] - Internal: the path so far.
 * @returns {string[]} The undeclared paths, shallowest-first.
 */
export function undeclaredPaths(data, declared, prefix = "") {
    const out = [];
    if (!isMapping(data)) return out;
    for (const [key, value] of Object.entries(data)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (!declared.has(path)) {
            out.push(path);
            continue;
        }
        if (isMapping(value) && Object.keys(value).length) {
            out.push(
                ...undeclaredPaths(/** @type {Record<string, unknown>} */ (value), declared, path),
            );
        }
    }
    return out;
}

/**
 * Keys directly under a system block that neither this format nor the system
 * recognizes.
 *
 * Until now an unrecognized key under `sohl:` was reported only against SoHL's
 * *field* vocabulary, and a key under any other system's block was not looked
 * at at all — dropped in silence, which is the failure class the frontmatter
 * lint exists for.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} block - The block key.
 * @param {object} options - Options.
 * @param {Iterable<string>} options.known - The keys this system declares on
 *   top of the shared vocabulary: its generators, its toolchain keys, and —
 *   until #126 moves them — the field names its notes still author in the
 *   block.
 * @returns {string[]} The unrecognized keys, in authored order.
 */
export function unknownBlockKeys(fm, block, { known }) {
    const declared = systemBlock(fm, block);
    if (!declared) return [];
    const accepted = new Set(known);
    return Object.keys(declared).filter((key) => !SYSTEM_BLOCK_KEYS.has(key) && !accepted.has(key));
}

/**
 * The `system` paths a field declaration writes, for {@link mergeSystemData}.
 *
 * Exactly each field's `to`, and deliberately **not** its ancestors: a field
 * writing `locations.flexible` does not own `locations`, and claiming the
 * container would make an authored `locations.facing` disappear — a silent drop
 * inside the mechanism built to stop them.
 *
 * @param {readonly {to?: string}[]} [fields] - A type's field declaration.
 * @returns {Set<string>} The claimed destinations.
 */
export function claimedPaths(fields) {
    return new Set(
        (fields ?? [])
            .map((field) => field?.to)
            .filter((to) => typeof to === "string" && to !== ""),
    );
}

/**
 * Merge a note's `<system>.system` onto a built `system` block, verbatim.
 *
 * **Verbatim means the paths are the schema's, not that the merge is a
 * replacement.** A container the builder already wrote is merged into rather
 * than overwritten, so authoring one leaf of `body` does not silently discard
 * the rest of it.
 *
 * A path a **declared field** already claims is left alone. That field's value
 * came from the same authored place, through the field's own `read`; writing it
 * again uncoerced would make the coercion depend on which of two mechanisms ran
 * last — the drift a single statement of the mapping exists to prevent.
 *
 * @param {object} built - The `system` block the builder produced (mutated).
 * @param {object} fm - The note's frontmatter.
 * @param {object} options - Options.
 * @param {string} options.block - The block key.
 * @param {ReadonlySet<string>} [options.claimed] - Paths a declared field
 *   writes, which this merge leaves to it.
 * @returns {object} `built`, for chaining.
 */
export function mergeSystemData(built, fm, { block, claimed = new Set() }) {
    const data = systemData(fm, block);
    for (const path of systemDataPaths(data)) {
        const value = getFrontmatter(data, path, undefined);
        // Walk *through* a container: its children are written individually, so
        // a builder's other keys under the same container survive.
        if (isMapping(value) && Object.keys(value).length) continue;
        if (claimedBy(path, claimed)) continue;
        setPath(built, path, value);
    }
    return built;
}

/**
 * Whether a declared field claims a path, or any container above it.
 *
 * @param {string} path - The authored path.
 * @param {ReadonlySet<string>} claimed - The declared destinations.
 * @returns {boolean} True when a field already writes it.
 */
function claimedBy(path, claimed) {
    const parts = path.split(".");
    for (let i = parts.length; i >= 1; i -= 1) {
        if (claimed.has(parts.slice(0, i).join("."))) return true;
    }
    return false;
}
