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
 * **The items a note lists, and the item notes they name.**
 *
 * Gear, afflictions and mystical abilities are things in a setting's world; only
 * their numbers belong to a game system. A being, or a culture, lists what it
 * has or typically carries in one `data.items` list, and an item note carries a
 * system-neutral `data` block, so an entry can give `model` alone.
 *
 * An entry is `{key?, model?, name?, img?, kind?, chance?, system?: {subType?,
 * quantity?, weight?}}`. Without `model`, `name` and `kind` are required and the
 * entry defines an item inline. An item note's `data` block follows the same
 * shape: `kind` (required), `name`, `img` and `system`.
 *
 * **The Address rule.** A `model` must resolve to an item note defined in the
 * note's own content package or in a package it requires as a module, followed
 * transitively through each module's own required modules, and never in a game
 * system at any level. A system-defined item here would bind the listing note
 * to that system. `sohl.items` and `hm3.items` carry no such restriction.
 *
 * **Transitive modules.** The note's own configuration states its direct
 * `relationships.requires` entries of type `module`. Each package publishes the
 * modules it requires once, on its own index record, whether or not it holds item
 * notes, so the walk continues through the cached index of each module reached.
 * A module reached only through another module needs no declaration of its own.
 *
 * @module
 */

import { canonicalKey, isAddressTuple, parseAddress, readCanonicalKey } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isPlainMap } from "./data-keys.mjs";
import { SHIPPED_SYSTEMS } from "./subtype-registry.mjs";
import { NOTE_SYSTEM } from "./systems.mjs";
import { ITEM_KINDS, ITEM_NOTE_TYPES, itemsField } from "./item-terms.mjs";
/** The shared item-list field with its entry validation. */
export const ITEMS_FIELD = itemsField(checkItems);
export { ITEM_KINDS, ITEM_NOTE_TYPES, ITEM_ENTRY, ITEM_NOTE_FIELDS } from "./item-terms.mjs";
export { resolveItemDefaults } from "./system-item-entries.mjs";

/** Where the path of one frontmatter value sits, as a located finding. */
function finding(note, path, message, key = false) {
    return {
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", path, { key }),
        severity: "error",
        message,
    };
}

/**
 * The content package names a configuration's relationships name as modules it
 * requires.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {string[]} The package names, in declaration order.
 */
export function requiredModulePackages(config) {
    return (config?.relationships?.requires ?? [])
        .filter((rel) => (rel.type ?? "module") === "module")
        .map((rel) => rel.contentPackage ?? rel.id);
}

/**
 * The content packages that are game systems, at any level of a relationship.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Set<string>} The package names.
 */
export function systemPackages(config) {
    const out = new Set(SHIPPED_SYSTEMS);
    for (const id of Object.keys(config?.systems ?? {})) out.add(id);
    if (config?.requiresSystem) out.add(config.requiresSystem);
    for (const [kind, entries] of Object.entries(config?.relationships ?? {})) {
        for (const rel of entries ?? []) {
            if (kind === "systems" || rel.type === "system") out.add(rel.contentPackage ?? rel.id);
        }
    }
    return out;
}

/**
 * The packages an item may be listed from: the note's own and every module it
 * requires, directly or through other required modules. A game system is never
 * entered.
 *
 * @param {object} config - The resolved build configuration.
 * @param {ReadonlyMap<string, readonly string[]>} [published] - Each fetched
 *   package's required modules, as its index publishes them.
 * @returns {Set<string>} The package names.
 */
export function itemPackages(config, published = new Map()) {
    const systems = systemPackages(config);
    const reached = new Set([config.contentPackage]);
    const queue = [...requiredModulePackages(config)];
    while (queue.length) {
        const pkg = queue.shift();
        if (reached.has(pkg) || systems.has(pkg)) continue;
        reached.add(pkg);
        queue.push(...(published.get(pkg) ?? []));
    }
    return reached;
}

/** Fetched item notes by index, as `package\0type\0shortcode`. */
const FETCHED_ITEM_NOTES = new WeakMap();

/** Whether a fetched package publishes an item note of this identity. */
function fetchedItemNote(index, tuple) {
    let known = FETCHED_ITEM_NOTES.get(index);
    if (!known) {
        known = new Set();
        for (const key of index.foreign?.index?.keys() ?? []) {
            const parts = readCanonicalKey(key);
            if (parts) known.add(`${parts.package}\0${parts.type}\0${parts.shortcode}`);
        }
        FETCHED_ITEM_NOTES.set(index, known);
    }
    return known.has(`${tuple.package}\0${tuple.type}\0${tuple.shortcode}`);
}

/**
 * The finding for one `model`, or none.
 *
 * @param {object} note - The note.
 * @param {unknown} model - The decoded or authored value.
 * @param {Array<string|number>} path - Where it sits.
 * @param {object} index - The link index.
 * @returns {object[]} Zero or one finding.
 */
function checkModel(note, model, path, index) {
    const where = `\`${path.join(".").replace(/\.(\d+)/g, "[$1]")}\``;
    const fail = (message) => [finding(note, path, `${where} ${message}`)];
    const tuple =
        isAddressTuple(model) ? model
        : typeof model === "string" ?
            parseAddress(model, { package: index.contentPackage, system: NOTE_SYSTEM })
        :   undefined;
    if (!tuple || tuple.reason || !isAddressTuple(tuple))
        return fail(
            `is ${JSON.stringify(model)}, which is not an accepted Address; ` +
                "write the Address of an item note, such as `weapongear-sword`",
        );
    const written = canonicalKey(tuple.package, NOTE_SYSTEM, tuple.type, tuple.shortcode);
    if (tuple.system !== NOTE_SYSTEM)
        return fail(
            `names the \`${tuple.system}\` document of \`${tuple.package}\`; write the note ` +
                `Address \`${written}\`, because an entry names the item note and each ` +
                "system's block of it is read from the note",
        );
    const config = index.config;
    const systems = systemPackages(config);
    if (systems.has(tuple.package))
        return fail(
            `names \`${written}\`, which \`${tuple.package}\` — a game system — defines. ` +
                "Items a note lists belong to a setting and never to a system; name an item " +
                "note of this package or of a module it requires, or state the entry in the " +
                `\`${tuple.package}.items\` list instead`,
        );
    const reachable = itemPackages(config, index.foreign?.requires);
    if (!reachable.has(tuple.package))
        return fail(
            `names \`${written}\`, but this package does not require \`${tuple.package}\` as a ` +
                "module, directly or through a module it requires. Add it under " +
                "`relationships.requires` with `type: module`, or name an item note of this " +
                "package",
        );
    if (!ITEM_NOTE_TYPES.includes(tuple.type))
        return fail(
            `names a \`${tuple.type}\` note, which is not an item note; \`model\` names a note ` +
                `of type ${ITEM_NOTE_TYPES.map((type) => `\`${type}\``).join(", ")}`,
        );
    if (!index.addressHit(written) && !fetchedItemNote(index, tuple))
        return fail(
            `names \`${written}\`, which resolves to no note; correct the Address, add the ` +
                `item note to \`${tuple.package}\`, or run \`package-build deps fetch\` when ` +
                `\`${tuple.package}\` is a module whose index has not been fetched`,
        );
    return [];
}

/**
 * Check the entries of a note's `data.items`.
 *
 * Beyond the shape the inner-key check holds them to: an inline entry states its
 * `name` and `kind`, `chance` lies between 0 and 100, a `key` is used once, and
 * a `model` obeys the Address rule.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @param {{index?: object}} [options] - The lint's options.
 * @returns {object[]} Findings, each located at the entry's own key.
 */
export function checkItems(note, { index } = {}) {
    const items = note.fm?.data?.items;
    if (!Array.isArray(items)) return [];
    const findings = [];
    const seen = new Map();
    items.forEach((entry, at) => {
        if (!isPlainMap(entry)) return;
        const path = ["data", "items", at];
        const label = `data.items[${at}]`;
        if (entry.model == null || entry.model === "") {
            if (entry.name == null || entry.name === "")
                findings.push(
                    finding(
                        note,
                        path,
                        `\`${label}\` defines an item inline but states no \`name\`; add \`name\`, ` +
                            "or give `model` naming an item note",
                    ),
                );
            if (entry.kind == null || entry.kind === "")
                findings.push(
                    finding(
                        note,
                        path,
                        `\`${label}\` defines an item inline but states no \`kind\`; add \`kind\`, ` +
                            "or give `model` naming an item note",
                    ),
                );
        } else if (index?.config)
            findings.push(...checkModel(note, entry.model, [...path, "model"], index));
        const chance = Number(entry.chance);
        if (
            entry.chance != null &&
            entry.chance !== "" &&
            Number.isFinite(chance) &&
            (chance < 0 || chance > 100)
        )
            findings.push(
                finding(
                    note,
                    [...path, "chance"],
                    `\`${label}.chance\` is ${chance}, outside 0 to 100; write the percent chance ` +
                        "that the item is drawn",
                ),
            );
        if (typeof entry.key === "string") {
            const first = seen.get(entry.key);
            if (first === undefined) seen.set(entry.key, at);
            else
                findings.push(
                    finding(
                        note,
                        [...path, "key"],
                        `\`${label}.key\` "${entry.key}" is already the key of \`data.items[${first}]\`; ` +
                            "give this entry its own `key`, or delete it if it is a duplicate",
                    ),
                );
        }
    });
    return findings;
}

/**
 * Check that no `key` repeats within one system's `items` list.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @param {string} blockName - The system block whose `items` to check.
 * @returns {object[]} One finding per repeat, at the later entry's `key`.
 */
export function checkSystemItemKeys(note, blockName) {
    const items = note.fm?.[blockName]?.items;
    if (!Array.isArray(items)) return [];
    const findings = [];
    const seen = new Map();
    items.forEach((entry, at) => {
        if (!isPlainMap(entry) || typeof entry.key !== "string") return;
        const first = seen.get(entry.key);
        if (first === undefined) {
            seen.set(entry.key, at);
            return;
        }
        findings.push(
            finding(
                note,
                [blockName, "items", at, "key"],
                `\`${blockName}.items[${at}].key\` "${entry.key}" is already the key of ` +
                    `\`${blockName}.items[${first}]\`; give this entry its own \`key\`, or ` +
                    "delete it if it is a duplicate",
            ),
        );
    });
    return findings;
}

/**
 * Check an item note's `data` block: it states its `kind`.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @returns {object[]} The finding, located at `data`, or none.
 */
export function checkItemNote(note) {
    if (!ITEM_NOTE_TYPES.includes(note.fm?.type)) return [];
    const kind = note.fm?.data?.kind;
    if (kind != null && kind !== "") return [];
    return [
        finding(
            note,
            note.fm?.data == null ? ["type"] : ["data"],
            `a \`${note.fm.type}\` note states what sort of item it is; add \`data.kind\`, one ` +
                `of ${ITEM_KINDS.map((word) => `\`${word}\``).join(", ")}`,
            true,
        ),
    ];
}

/**
 * Check that only a culture lists the items its people carry.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @returns {object[]} The finding, located at `data.items`, or none.
 */
export function checkCultureItems(note) {
    if (note.fm?.type !== "lore" || note.fm?.subType === "culture") return [];
    if (note.fm?.data?.items === undefined) return [];
    return [
        finding(
            note,
            ["data", "items"],
            "`data.items` on a lore note states what a culture's people carry; set `subType: " +
                "culture`, or delete `data.items`",
            true,
        ),
    ];
}
