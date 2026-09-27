/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Preserve an exported Foundry Scene while binding marked pins to note pages. */

import { journalPageId, splitPages } from "./journals.mjs";

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

/** Apply author-declared asset address replacements to an exported Scene. */
function applyFixups(scene, fixups, resolveAddress) {
    if (fixups === undefined) return;
    if (!Array.isArray(fixups)) throw new Error("`data.fixup` must be an array");
    for (const [index, fixup] of fixups.entries()) {
        if (
            !fixup ||
            typeof fixup !== "object" ||
            Array.isArray(fixup) ||
            fixup.type !== "address" ||
            typeof fixup.value !== "string" ||
            !fixup.value
        ) {
            throw new Error(
                `data.fixup[${index}] needs path, type: address, and an asset address value`,
            );
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
}

/** Add a compendium key to one exported embedded document. */
function keyDocument(doc, collection, parentIds, sceneId) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        throw new Error(`data.scene.${collection} contains a non-document value`);
    }
    if (!/^[A-Za-z0-9]{16}$/.test(doc._id ?? "")) {
        throw new Error(`data.scene.${collection} needs a 16-character _id on every document`);
    }
    doc._key = `!scenes.${collection}!${[sceneId, ...parentIds, doc._id].join(".")}`;
}

/**
 * Compile a Foundry Scene export into a pack document.
 *
 * Only the note-derived Scene ID, compendium metadata, and pins marked
 * `#anchor` change. Every other authored Scene field passes through.
 *
 * @param {object} fm - The map note's frontmatter.
 * @param {string} markdown - Its converted Markdown body.
 * @param {object} [opts] - Pack metadata, derived JournalEntry ID, and asset resolver.
 * @returns {object} The keyed Scene document.
 */
export function buildExportedScene(fm, markdown, { journalEntryId, stats, resolveAddress } = {}) {
    if (!["battlemap", "localmap"].includes(fm.subType)) {
        throw new Error("`data.scene` is for battlemap and localmap notes");
    }
    const source = fm.data?.scene;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error("a map note needs a Foundry Scene object at `data.scene`");
    }
    if (!/^[A-Za-z0-9]{16}$/.test(fm.id ?? "")) {
        throw new Error("a map note needs a derived 16-character Scene ID");
    }
    const scene = structuredClone(source);
    applyFixups(scene, fm.data?.fixup, resolveAddress);
    if (
        !(Number.isInteger(scene.width) && scene.width > 0) ||
        !(Number.isInteger(scene.height) && scene.height > 0)
    ) {
        throw new Error("`data.scene` needs positive whole-number width and height");
    }
    if (!Array.isArray(scene.levels) || scene.levels.length === 0) {
        throw new Error("`data.scene.levels` needs at least one Level");
    }
    scene._id = fm.id;
    scene._key = `!scenes!${fm.id}`;
    if (stats) scene._stats = stats;

    for (const collection of EMBEDDED) {
        const docs = scene[collection];
        if (docs === undefined) continue;
        if (!Array.isArray(docs)) {
            throw new Error(`data.scene.${collection} must be an array`);
        }
        const ids = new Set();
        for (const doc of docs) {
            keyDocument(doc, collection, [], fm.id);
            if (ids.has(doc._id))
                throw new Error(`data.scene.${collection} repeats _id ${doc._id}`);
            ids.add(doc._id);
            if (collection !== "regions" || doc.behaviors === undefined) continue;
            if (!Array.isArray(doc.behaviors)) {
                throw new Error("data.scene.regions.behaviors must be an array");
            }
            const behaviorIds = new Set();
            for (const behavior of doc.behaviors) {
                keyDocument(behavior, "regions.behaviors", [doc._id], fm.id);
                if (behaviorIds.has(behavior._id)) {
                    throw new Error(`data.scene.regions.behaviors repeats _id ${behavior._id}`);
                }
                behaviorIds.add(behavior._id);
            }
        }
    }
    if (scene.initialLevel && !scene.levels.some((level) => level._id === scene.initialLevel)) {
        throw new Error(`data.scene.initialLevel "${scene.initialLevel}" names no Level`);
    }

    const pages = new Map();
    for (const page of splitPages(markdown, fm.name?.full ?? scene.name)) {
        if (!page.anchorSlug) continue;
        if (pages.has(page.anchorSlug)) {
            throw new Error(`the map note repeats anchor "${page.anchorSlug}"`);
        }
        pages.set(page.anchorSlug, page);
    }
    for (const pin of scene.notes ?? []) {
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
