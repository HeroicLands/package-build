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

/** Preserve an exported Foundry Scene while binding marked pins to note pages. */

import { journalPageId, splitPages } from "./journals.mjs";
import { dataFields } from "./note-vocabulary.mjs";
import { isAddressTuple, renderAddress } from "./address.mjs";

const EMBEDDED = Object.freeze([
    "drawings",
    "tokens",
    "lights",
    "notes",
    "sounds",
    "tiles",
    "walls",
    "regions",
    "levels",
]);

/** Parse the deliberately small path syntax used inside a Scene fixup. */
function fixupSegments(path) {
    if (typeof path !== "string" || !path.startsWith(".")) {
        throw new Error("a Scene fixup path must start with `.`");
    }
    const segments = [];
    let at = 0;
    while (at < path.length) {
        const rest = path.slice(at);
        const property = /^\.([A-Za-z_$][A-Za-z0-9_$]*)/.exec(rest);
        if (property) {
            segments.push({ kind: "property", key: property[1] });
            at += property[0].length;
            continue;
        }
        const bareId = /^\[([A-Za-z0-9]{16})\]/.exec(rest);
        if (bareId) {
            segments.push({ kind: "id", key: bareId[1] });
            at += bareId[0].length;
            continue;
        }
        const byId = /^\[_id=(?:"([A-Za-z0-9]{16})"|'([A-Za-z0-9]{16})'|([A-Za-z0-9]{16}))\]/.exec(
            rest,
        );
        if (byId) {
            segments.push({ kind: "id", key: byId[1] ?? byId[2] ?? byId[3] });
            at += byId[0].length;
            continue;
        }
        const index = /^\[(\d+)\]/.exec(rest);
        if (index) {
            segments.push({ kind: "index", key: Number(index[1]) });
            at += index[0].length;
            continue;
        }
        throw new Error(`invalid Scene fixup path "${path}" at "${rest}"`);
    }
    return segments;
}

/** Find the existing field a fixup addresses, without creating paths. */
function fixupTarget(scene, path) {
    const segments = fixupSegments(path);
    let current = scene;
    for (const segment of segments.slice(0, -1)) {
        if (segment.kind === "property") {
            if (!current || typeof current !== "object" || !Object.hasOwn(current, segment.key)) {
                throw new Error(`Scene fixup path "${path}" has no property "${segment.key}"`);
            }
            current = current[segment.key];
        } else if (segment.kind === "index") {
            if (!Array.isArray(current) || segment.key >= current.length) {
                throw new Error(`Scene fixup path "${path}" has no array index ${segment.key}`);
            }
            current = current[segment.key];
        } else {
            if (!Array.isArray(current)) {
                throw new Error(`Scene fixup path "${path}" needs an array for _id selection`);
            }
            const matches = current.filter((value) => value?._id === segment.key);
            if (matches.length !== 1) {
                throw new Error(`Scene fixup path "${path}" matches ${matches.length} documents`);
            }
            current = matches[0];
        }
    }
    const last = segments.at(-1);
    if (
        last?.kind !== "property" ||
        !current ||
        typeof current !== "object" ||
        !Object.hasOwn(current, last.key)
    ) {
        throw new Error(`Scene fixup path "${path}" must end at an existing property`);
    }
    return { parent: current, key: last.key };
}

/**
 * Every fixup a map note states, each with the key it was authored at.
 *
 * Two sources, applied by one mechanism. `data.fixup` names its Scene paths
 * outright. A map field declaring a `sceneProperty` — `thumbnail`, written into
 * `.thumb` — names the Scene property in the vocabulary instead, so the note
 * states only the Address and the compile adds the entry. A declared field and
 * an authored entry writing one property is refused: either would silently
 * overwrite the other.
 *
 * @param {object} fm - The map note's frontmatter.
 * @returns {Array<{label: string, fixup: unknown}>} The fixups, authored first.
 * @throws {Error} When `data.fixup` is not a list, or two fixups write one path.
 */
function noteFixups(fm) {
    const authored = fm.data?.fixup;
    if (authored !== undefined && !Array.isArray(authored)) {
        throw new Error("`data.fixup` must be an array");
    }
    const out = (authored ?? []).map((fixup, index) => ({ label: `data.fixup[${index}]`, fixup }));
    for (const field of dataFields("map") ?? []) {
        if (!field.sceneProperty) continue;
        const value = fm.data?.[field.name];
        if (value === undefined || value === null || value === "") continue;
        const label = `data.${field.name}`;
        const clash = out.find(({ fixup }) => fixup?.path === field.sceneProperty);
        if (clash) {
            throw new Error(
                `\`${label}\` and \`${clash.label}\` both write \`${field.sceneProperty}\`; ` +
                    `keep one of them`,
            );
        }
        out.push({
            label,
            fixup: {
                path: field.sceneProperty,
                type: "address",
                value: isAddressTuple(value) ? renderAddress(value) : value,
            },
        });
    }
    return out;
}

/** Apply a map note's asset address replacements to its exported Scene. */
function applyFixups(scene, fixups, resolveAddress) {
    for (const { label, fixup } of fixups) {
        try {
            applyFixup(scene, label, fixup, resolveAddress);
        } catch (error) {
            // An entry the compile added says which key the note wrote, since
            // the path it failed on appears nowhere in the note.
            if (label.startsWith("data.fixup[")) throw error;
            throw new Error(`\`${label}\`: ${error.message}`, { cause: error });
        }
    }
}

/** Resolve one fixup's Address and write its path into the Scene. */
function applyFixup(scene, label, fixup, resolveAddress) {
    if (
        !fixup ||
        typeof fixup !== "object" ||
        Array.isArray(fixup) ||
        fixup.type !== "address" ||
        typeof fixup.value !== "string" ||
        !fixup.value
    ) {
        throw new Error(`${label} needs path, type: address, and an asset address value`);
    }
    const { parent, key } = fixupTarget(scene, fixup.path);
    if (typeof parent[key] !== "string" && parent[key] !== null) {
        throw new Error(`Scene fixup path "${fixup.path}" must name a string asset field`);
    }
    if (typeof resolveAddress !== "function") {
        throw new Error("Scene address fixups need an asset resolver");
    }
    const resolved = resolveAddress(fixup.value);
    if (typeof resolved !== "string" || !resolved) {
        throw new Error(`Scene fixup address "${fixup.value}" does not resolve to an asset`);
    }
    parent[key] = resolved;
}

/**
 * Add a compendium key to every embedded document that carries an `_id`.
 *
 * The keys are what the compendium CLI splits embedded documents by. A value
 * that is not a document, or one carrying no `_id`, passes through as exported.
 *
 * @param {unknown} docs - One embedded collection, as exported.
 * @param {string} collection - Its key path, such as `regions.behaviors`.
 * @param {string[]} parentIds - The ids of the documents it is embedded in.
 * @param {string} sceneId - The Scene's derived id.
 * @returns {void}
 */
function keyDocuments(docs, collection, parentIds, sceneId) {
    if (!Array.isArray(docs)) return;
    for (const doc of docs) {
        if (!doc || typeof doc !== "object" || Array.isArray(doc)) continue;
        if (typeof doc._id !== "string" || !doc._id) continue;
        doc._key = `!scenes.${collection}!${[sceneId, ...parentIds, doc._id].join(".")}`;
        if (collection === "regions") {
            keyDocuments(doc.behaviors, "regions.behaviors", [doc._id], sceneId);
        }
    }
}

/**
 * Compile a Foundry Scene export into a pack document.
 *
 * The Scene passes through as exported. Only the note-derived Scene ID,
 * compendium metadata, the fixups — `data.fixup` and the map fields that
 * declare a Scene property, such as `data.thumbnail` — and pins marked
 * `#anchor` change; nothing else inside the Scene is read or checked.
 *
 * @param {object} fm - The map note's frontmatter.
 * @param {string} markdown - Its converted Markdown body.
 * @param {{journalEntryId?: string, stats?: object, resolveAddress?: Function}} [opts] - Pack metadata, derived JournalEntry ID, and asset resolver.
 * @returns {object} The keyed Scene document.
 * @throws {Error} When `data.scene` is not an object, or a fixup or pin anchor
 *   names something the Scene or the note does not have.
 */
export function buildExportedScene(fm, markdown, { journalEntryId, stats, resolveAddress } = {}) {
    const source = fm.data?.scene;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error("a map note needs a Foundry Scene object at `data.scene`");
    }
    if (!/^[A-Za-z0-9]{16}$/.test(fm.id ?? "")) {
        throw new Error("a map note needs a derived 16-character Scene ID");
    }
    const scene = structuredClone(source);
    applyFixups(scene, noteFixups(fm), resolveAddress);
    scene._id = fm.id;
    scene._key = `!scenes!${fm.id}`;
    if (stats) scene._stats = stats;
    for (const collection of EMBEDDED) keyDocuments(scene[collection], collection, [], fm.id);

    const pages = new Map();
    for (const page of splitPages(markdown, fm.name?.full ?? scene.name)) {
        if (!page.anchorSlug) continue;
        if (pages.has(page.anchorSlug)) {
            throw new Error(`the map note repeats anchor "${page.anchorSlug}"`);
        }
        pages.set(page.anchorSlug, page);
    }
    for (const pin of Array.isArray(scene.notes) ? scene.notes : []) {
        if (!pin || typeof pin !== "object") continue;
        const match = /^#([A-Za-z0-9][A-Za-z0-9_-]*)$/.exec(String(pin.text ?? ""));
        if (!match) continue;
        const page = pages.get(match[1]);
        if (!page) throw new Error(`Scene pin "${pin.text}" names no heading anchor in this note`);
        if (!journalEntryId) {
            throw new Error(`Scene pin "${pin.text}" needs a JournalEntry from this note`);
        }
        pin.entryId = journalEntryId;
        pin.pageId = journalPageId(journalEntryId, page);
        pin.text = page.name;
    }
    return scene;
}
