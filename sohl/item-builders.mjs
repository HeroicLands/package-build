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
 * **The item-type registry** — every content type that compiles into a Foundry
 * Item, keyed to the builder that produces its `system` block.
 *
 * There is one list, not two. This repository hands {@link ITEM_BUILDERS} to
 * the build as `itemBuilders` in `package-build.config.yaml`, and `itemTypes()`
 * — the whitelist — is derived from that table's own keys, so a type cannot be
 * whitelisted for compilation without a builder to compile it. Previously the
 * whitelist and the builder table were maintained by hand and had already
 * drifted: `trait` — an item type **retired in #651**, absent from
 * `documentTypes.Item` and reported by world migration as unrecognized — was
 * still advertised as compilable, so a `type: trait` note passed the gate and
 * then died on `BUILDERS[type] is not a function`, swallowed as a per-file
 * error (#1504).
 *
 * **The builders are generated, not written.** Each type's `system` builder
 * comes from its field declaration in `item-fields.mjs` by way of
 * {@link buildFromFields}, so the vocabulary a note may write is readable data
 * rather than statements buried in a function body — which is what lets the
 * authoring reference be generated and a note be linted against its type
 * (#22). One consequence worth naming: the registry's keys are now
 * {@link ITEM_FIELDS}'s keys, so adding an item type is one edit *there* (plus
 * its `documentTypes.Item` declaration and its default art), and removing one
 * is likewise a single deletion.
 *
 * **A leaf module, and the reason the seam works.** It imports only the pure
 * declaration primitives and the field table — never `helpers.mjs`, and never
 * the resolved configuration. The config file imports *this* module, so a read
 * back out of the configuration here would close a cycle around the config's
 * own evaluation. The table travels into configuration; the engine's
 * `item-registry.mjs` reads it back out and the Item compiler dispatches
 * through that, which is how a consumer's own table is the one its notes
 * compile with (#1563).
 */

import { defaultItemArt } from "./default-item-art.mjs";
import { buildFromFields, readField } from "../engine/field-spec.mjs";
import { COMBAT_TECHNIQUE_STRIKE_MODE, ITEM_FIELDS } from "./item-fields.mjs";

/**
 * The conditionals a flat field list cannot state, keyed by item type.
 *
 * A finalizer runs after the declaration has produced the `system` block, and
 * exists only for a field whose *presence* depends on another field's value.
 * There is exactly one: a combat technique is authored as a `skill` of subtype
 * `combattechnique`, and carries a strike mode that no other skill has.
 *
 * Keeping this list short is the point. Anything expressible as a field
 * declaration is said there, where a generator and a linter can read it; a
 * finalizer is opaque again, so it earns its place one conditional at a time.
 *
 * @type {Readonly<Record<string, (fm: object, out: object) => object>>}
 */
const FINALIZERS = Object.freeze({
    skill(fm, out) {
        if (out.subType === "combattechnique") {
            out.strikeMode = readField(COMBAT_TECHNIQUE_STRIKE_MODE, fm);
        }
        return out;
    },
});

/**
 * Build one registry entry: the declared fields, the builder they generate, and
 * the default art for the type.
 *
 * Reading {@link defaultItemArt} here is what makes the two lists one: this
 * module cannot name a type the art map does not cover, because that function
 * throws and this module evaluates at import. A drift that a test used to catch
 * is unrepresentable.
 *
 * Importing the art map keeps this module a leaf — it is plain data, not the
 * resolved configuration, and the cycle the module note above warns about is
 * only ever closed by reading configuration back out.
 *
 * @param {string} type - The item type, and the art map's key.
 * @returns {Readonly<{system: (fm: object) => object, img: string, fields: readonly object[]}>}
 *   The registry entry.
 */
function entryFor(type) {
    const fields = ITEM_FIELDS[type];
    const build = buildFromFields(fields);
    const finalize = FINALIZERS[type];
    return Object.freeze({
        system: finalize ? (fm) => finalize(fm, build(fm)) : build,
        img: defaultItemArt(type),
        fields,
    });
}

/**
 * Every item type, paired with the builder for its `system` block, the default
 * art for the type, and the frontmatter fields it declares.
 *
 * @type {Readonly<Record<string, Readonly<{system: (fm: object) => object, img: string, fields: readonly object[]}>>>}
 */
export const ITEM_BUILDERS = Object.freeze(
    Object.fromEntries(Object.keys(ITEM_FIELDS).map((type) => [type, entryFor(type)])),
);
