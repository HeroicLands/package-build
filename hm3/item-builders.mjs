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
 * **HM3's item-type registry** — every content type that compiles into an HM3
 * Foundry Item, keyed to the builder that produces its `system` block.
 *
 * The same arrangement as `sohl/item-builders.mjs`, and a repository feeding
 * both systems names both: `itemBuilders: [sohl, hm3]`. The engine keeps them
 * apart from there on — `itemBuilder(type, system)` takes the system that is
 * asking, and a type both registries declare **throws** rather than resolving
 * when nobody says which (#58). That guard existed before there was a second
 * registry to trip it; this is the registry it was written for.
 *
 * **The builders are generated, not written**, from the field declarations in
 * `item-fields.mjs`, compiled against the `hm3` block. `buildFromFields` takes
 * the block as an argument precisely so one declaration mechanism serves any
 * number of systems: `data.weight` reaches `system.weightBase` under `sohl:`
 * and `system.weight` under `hm3:`, from two declarations and one engine.
 *
 * **No finalizers.** SoHL has one — a combat technique's strike mode, whose
 * *presence* depends on another field's value — and HM3 has no such
 * conditional. The absence is worth stating: a finalizer is opaque to every
 * reader a declaration is legible to, so having none is the state to keep.
 *
 * **A leaf.** It imports the declaration primitives, the field table and the
 * art map, and never the resolved configuration — the configuration file
 * imports *this*, so a read back out would close a cycle around the
 * configuration's own evaluation.
 *
 * @module
 */

import { buildFromFields } from "../engine/field-spec.mjs";
import { hm3DefaultItemArt } from "./default-item-art.mjs";
import { HM3_DOCUMENT_SUBTYPES } from "./document-subtypes.mjs";
import { HM3_ITEM_FIELDS } from "./item-fields.mjs";

/**
 * The frontmatter block these builders read.
 *
 * Taken from the map rather than spelled here, so the block name, the subtype
 * map and the registry are one statement.
 *
 * @type {string}
 */
const BLOCK = HM3_DOCUMENT_SUBTYPES.block;

/**
 * Build one registry entry: the declared fields, the builder they generate, and
 * the default art for the type.
 *
 * @param {string} type - The note type, and the art map's key.
 * @returns {Readonly<{system: (fm: object) => object, img: string, fields: readonly object[]}>}
 *   The registry entry.
 */
function entryFor(type) {
    const fields = HM3_ITEM_FIELDS[type];
    return Object.freeze({
        system: buildFromFields(fields, { block: BLOCK }),
        img: hm3DefaultItemArt(type),
        fields,
    });
}

/**
 * Every HM3 item type, paired with the builder for its `system` block, the
 * default art for the type, and the frontmatter fields it declares.
 *
 * @type {Readonly<Record<string, Readonly<{system: (fm: object) => object, img: string, fields: readonly object[]}>>>}
 */
export const HM3_ITEM_BUILDERS = Object.freeze(
    Object.fromEntries(Object.keys(HM3_ITEM_FIELDS).map((type) => [type, entryFor(type)])),
);
