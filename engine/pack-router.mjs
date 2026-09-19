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
 * Which pack a note's document lands in, when a document type has more than
 * one.
 *
 * A repository used to be able to ship exactly one pack per document type: the
 * pipeline ran one compile pass per type and routed every note of that type
 * into that pass's pack. Editorial grouping of same-type documents into
 * separate compendiums is ordinary Foundry practice — "Core Spells" and
 * "Expanded Spells" are two Item packs — and `sohl-kethira-basic` shipped
 * three. Collapsing them is a breaking change for every existing world,
 * because a compendium UUID carries its pack name
 * (`Compendium.<pkg>.characteristics.Item.<id>`).
 *
 * **A note declares its pack; the configuration declares the default.** The
 * routing key is one frontmatter field, `pack:`, naming a pack from the
 * configured list — declarative and inspectable, so a maintainer reads where a
 * note lands rather than tracing a predicate. Its `type:` still selects the
 * *compiler*; the declaration selects *which pack of that type* receives the
 * document, and the two are orthogonal.
 *
 * The rules, in full:
 *
 * - A note that declares nothing lands in the **default** pack of its document
 *   type. A type with exactly one pack is that type's default implicitly, which
 *   is what keeps every existing one-pack-per-type configuration — and every
 *   note in it — behaving identically.
 * - A type with several packs designates its default with `default: true`.
 *   Where none does, a declaration is **mandatory** for every note of that type:
 *   an undeclared note routes nowhere and fails the build.
 * - A declared name that no pack answers to — or that names a pack holding
 *   another document type, or a companion pack, which no note may address —
 *   fails the build, naming the note and what it asked for. A silent fall-back
 *   to the default would be #1502 in a new costume.
 * - A note's **derived** documents are routed by the default of *their* type,
 *   not by the note's declaration: an item note's prose compiles into a
 *   JournalEntry, and `pack:` names where the *item* goes.
 * - A note feeding **more than one system** declares `pack:` inside the block
 *   that differs. `pack` needed no new mechanism for that: it is an
 *   ordinary shared property, so `<system>.pack` overrides the top-level one
 *   for that system's document and leaves it standing for every other. A note
 *   wanting one pack for both says it once at the top.
 * - A **default is per system**, not merely per type. The second rule
 *   above counts every pack of a type together, so one Actor pack per system is
 *   two packs and no default — while the note that feeds both declares no
 *   `pack:` at all, precisely because the rule above it makes a declaration the
 *   way to say the two *differ*. Asked per system the same layout is
 *   unambiguous, one pack each, and needs no flag for the same reason a
 *   single-pack type does not.
 * - **A system is never answered with another system's pack.** Neither by a
 *   type-wide default belonging to one, nor by a `pack:` naming one: in a block
 *   that is a contradiction and is refused by name, and at the top level it is
 *   a shared value that cannot describe a system-specific pack, so it does not
 *   answer and that system falls through to its own default. Both were silent
 *   losses of one system's whole document set.
 *
 * @module
 */

import { packForType } from "./ids.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { blockProperty, systemBlock } from "./system-block.mjs";

/**
 * A note that cannot be routed to a pack. Thrown rather than returned so no
 * caller can carry on with a plausible-looking default.
 */
export class PackRoutingError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = "PackRoutingError";
    }
}

/**
 * The frontmatter field a note declares its pack in.
 *
 * Deliberately close to the retired `package:` and deliberately not the same
 * word: `package:` said which *distribution* owned a note — now the
 * repository's `contentPackage`, and no longer authorable — while `pack:`
 * says which *compendium* receives its document.
 */
export const PACK_FIELD = "pack";

/**
 * Build the router for one configured pack list.
 *
 * Pure — it reads the list and nothing else, so a consumer's routing can be
 * tested without a content tree or a config file on disk.
 *
 * @param {readonly object[]} packs - The resolved `packs` list from
 *   `defineConfig`.
 * @returns {{resolve: (fm: object, docType: string, system?: string) => string,
 *   resolveOrNull: (fm: object, docType: string, system?: string) => string|undefined,
 *   packsOfType: (docType: string) => string[],
 *   defaultOf: (docType: string) => string|undefined}} The router.
 */
export function createPackRouter(packs) {
    /** Routable packs — a companion is written by its parent's pass. */
    const byName = new Map();
    /** Companion names, so addressing one can be refused by name. */
    const companions = new Set();
    /** @type {Map<string, string[]>} */
    const byType = new Map();
    /** @type {Map<string, string>} */
    const defaults = new Map();
    /** `[type, system]` → the packs of that type declaring that system. */
    const byTypeAndSystem = new Map();
    /** The same key → that system's default pack of the type. */
    const defaultsBySystem = new Map();

    /**
     * Pair a type with a system, so one `Map` can be keyed by both.
     *
     * The key is opaque — nothing takes it apart again — so it needs only to
     * be injective, and `JSON.stringify` quotes and escapes each half to give
     * that. A raw delimiter would have to be a character neither a type nor a
     * system id can hold, and every such character is a control character:
     * invisible in a diff, in a review and in a failed assertion's output.
     *
     * @param {string} type - The document type.
     * @param {string} system - The system id.
     * @returns {string} The composite key.
     */
    const systemKey = (type, system) => JSON.stringify([type, system]);

    for (const pack of packs ?? []) {
        byName.set(pack.name, pack);
        const names = byType.get(pack.type) ?? [];
        names.push(pack.name);
        byType.set(pack.type, names);
        if (pack.default) defaults.set(pack.type, pack.name);
        if (pack.system) {
            const key = systemKey(pack.type, pack.system);
            const forSystem = byTypeAndSystem.get(key) ?? [];
            forSystem.push(pack.name);
            byTypeAndSystem.set(key, forSystem);
            if (pack.default) defaultsBySystem.set(key, pack.name);
        }
        for (const companion of pack.companions ?? []) {
            companions.add(companion.name);
        }
    }
    // A type with exactly one pack needs no `default: true` to have one: the
    // single-pack layout is the common case, and requiring the flag there would
    // make every existing configuration invalid for no gain.
    for (const [type, names] of byType) {
        if (names.length === 1) defaults.set(type, names[0]);
    }
    // **And a default is per system, not merely per type**. The rule above
    // counts every pack of a type together, so a tree shipping one Actor pack
    // per system has two and therefore no default — and since a note feeding
    // both systems declares no `pack:` at all (the whole point: it says where
    // its SoHL document goes only when that differs from where its HM3 one
    // does), every one of `harn-ensemble`'s 2,519 notes routed nowhere and the
    // build failed naming each in turn.
    //
    // Asking per system, the same layout is unambiguous: one Actor pack
    // declares `system: sohl` and one declares `system: hm3`, so each system
    // has exactly one and needs no flag, for the same reason a single-pack type
    // does not.
    for (const [key, names] of byTypeAndSystem) {
        if (names.length === 1 && !defaultsBySystem.has(key)) defaultsBySystem.set(key, names[0]);
    }

    /** @param {object} fm */
    const noteLabel = (fm) => fm?.name?.full ?? fm?.shortcode ?? fm?.id ?? "a note";

    /**
     * The pack a note declaring none is routed to.
     *
     * **A system never falls back to another system's pack.** Where one is
     * asking, only a pack of that system answers, or one that declares no
     * system at all and so belongs to all of them. The type-wide default is
     * otherwise free to be a neighbour's — `actors-sohl` is what
     * `CONTENT.md`'s two-system layout marks `default: true` — and returning it
     * to the HM3 pass would either route an HM3 document into the SoHL pack or,
     * as it actually did, have the HM3 pass see a pack name that is not its own
     * and skip every note in the tree. The second is worse: it is silent, and
     * the pack compiles zero entries.
     *
     * @param {string} docType - The document type being routed.
     * @param {string} [system] - The system asking, where one is.
     * @returns {string|undefined} The pack name, or `undefined`.
     */
    function defaultFor(docType, system) {
        if (system === undefined) return defaults.get(docType);
        const own = defaultsBySystem.get(systemKey(docType, system));
        if (own) return own;
        const typeDefault = defaults.get(docType);
        return typeDefault && !byName.get(typeDefault)?.system ? typeDefault : undefined;
    }

    /**
     * The pack one pass should write this note's document to.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} docType - The document type the calling pass writes.
     * @param {string} [system] - The system whose document is being routed. Its
     *   block's `pack:` wins over the shared one; without it only the shared
     *   declaration is read, which is every single-system build.
     * @returns {string} The pack name.
     * @throws {PackRoutingError} When the note routes nowhere.
     */
    function resolve(fm, docType, system) {
        const inBlock = system === undefined ? undefined : systemBlock(fm, system)?.[PACK_FIELD];
        const authoredInBlock = inBlock != null && inBlock !== "";
        let declared =
            system === undefined ? fm?.[PACK_FIELD] : blockProperty(fm, system, PACK_FIELD);
        // The declaration names where the note's *own* document goes. A pass
        // writing a document derived from it — an item's prose becoming a
        // JournalEntry — is not what the author was addressing.
        const ownDocType = packForType(fm?.type).docType;

        // **A declaration naming another system's pack is not this system's
        // answer**, and which of two things that means depends on where
        // it was written.
        //
        // In the block, it is a contradiction: `hm3.pack` says where the *HM3*
        // document goes, so naming a pack declaring `system: sohl` asks for one
        // system's document in another's compendium. Refused by name, because
        // the alternative is the HM3 pass seeing a pack that is not its own and
        // passing over the note in silence.
        //
        // At the top level it is no contradiction at all: the shared position
        // is the value a note states once for *every* system, and a
        // system-specific pack cannot be that value. So it simply does not
        // answer here, and this system falls through to its own default — which
        // is what lets a note pin its SoHL pack at the top level and still
        // compile its HM3 document.
        if (system !== undefined && declared != null && declared !== "") {
            const named = byName.get(declared);
            if (named?.system && named.system !== system) {
                if (authoredInBlock) {
                    throw new PackRoutingError(
                        `${noteLabel(fm)} declares \`${system}.pack: ${declared}\`, ` +
                            `but that pack declares \`system: ${named.system}\`. A ` +
                            `block's \`pack:\` names where *that* system's document ` +
                            `goes, so it must name a pack of that system or one ` +
                            `declaring none.`,
                    );
                }
                declared = undefined;
            }
        }

        if (declared != null && declared !== "" && docType === ownDocType) {
            if (companions.has(declared)) {
                throw new PackRoutingError(
                    `${noteLabel(fm)} declares \`pack: ${declared}\`, which is a ` +
                        `companion pack. A companion is written by another pack's ` +
                        `pass, so no note may be routed into one.`,
                );
            }
            const pack = byName.get(declared);
            if (!pack) {
                throw new PackRoutingError(
                    `${noteLabel(fm)} declares \`pack: ${declared}\`, which no ` +
                        `configured pack answers to. Declare it in ` +
                        `package-build.config.yaml, or correct the note. ` +
                        `Packs of type ${docType}: ` +
                        `${(byType.get(docType) ?? []).join(", ") || "(none)"}.`,
                );
            }
            if (pack.type !== docType) {
                throw new PackRoutingError(
                    `${noteLabel(fm)} is a ${docType} but declares ` +
                        `\`pack: ${declared}\`, which holds ${pack.type} ` +
                        `documents. A note's \`pack:\` names a pack of its own ` +
                        `document type.`,
                );
            }
            return declared;
        }

        const fallback = defaultFor(docType, system);
        if (!fallback) {
            const candidates =
                system === undefined ?
                    (byType.get(docType) ?? [])
                :   (byTypeAndSystem.get(systemKey(docType, system)) ?? []);
            throw new PackRoutingError(
                candidates.length ?
                    `${noteLabel(fm)} declares no \`pack:\`, and no ${docType} ` +
                        `pack${system === undefined ? "" : ` of system ${system}`} ` +
                        `is marked \`default: true\` — so it routes nowhere. Mark ` +
                        `one of ${candidates.join(", ")} as the default, or ` +
                        `declare the pack on the note.`
                : system === undefined ?
                    `${noteLabel(fm)} compiles into a ${docType}, but no pack ` +
                    `of that type is configured.`
                    // A system asking for a type it has no pack of. Said in its
                    // own words rather than the type-wide one, because the
                    // configuration may well hold several packs of the type —
                    // just none this system may be written into, and routing the
                    // document into a neighbour's pack is the failure this
                    // whole issue is about.
                :   `${noteLabel(fm)} compiles into a ${docType} for system ` +
                    `${system}, and no pack of that type declares ` +
                    `\`system: ${system}\`. Packs of type ${docType}: ` +
                    `${(byType.get(docType) ?? []).join(", ") || "(none)"}.`,
            );
        }
        return fallback;
    }

    return {
        resolve,

        /**
         * {@link resolve} for a caller that must not fail the build — the link
         * index, which addresses every note it can and leaves the compilers to
         * report the ones it cannot.
         *
         * @param {object} fm - The note's frontmatter.
         * @param {string} docType - The document type being addressed.
         * @param {string} [system] - The system whose document is addressed.
         * @returns {string|undefined} The pack name, or `undefined`.
         */
        resolveOrNull(fm, docType, system) {
            try {
                return resolve(fm, docType, system);
            } catch {
                return undefined;
            }
        },

        /**
         * Every routable pack of a document type, in configured order.
         *
         * @param {string} docType - The Foundry document type.
         * @returns {string[]} The pack names.
         */
        packsOfType(docType) {
            return [...(byType.get(docType) ?? [])];
        },

        /**
         * The systems declared by the packs of one document type.
         *
         * What a pass asks to tell a note that belongs to *another system's*
         * pass from one that is simply missing this system's block. A
         * repository feeding two systems declares an Item pack per system, so
         * a note carrying only `hm3:` is not an incomplete SoHL note — it is a
         * note the HM3 pass will claim, and the SoHL pass has to pass over it
         * rather than fail it.
         *
         * @param {string} docType - The Foundry document type.
         * @returns {string[]} The declared systems, deduplicated, in
         *   configured order. Empty where no pack of the type names one.
         */
        systemsOfType(docType) {
            const out = [];
            for (const name of byType.get(docType) ?? []) {
                const system = byName.get(name)?.system;
                if (system && !out.includes(system)) out.push(system);
            }
            return out;
        },

        /**
         * The system one pack declares, if it declares one.
         *
         * A pack declaring none takes the compiler its document type falls
         * back to, so `undefined` here is an answer rather than a gap: it says
         * the pack's documents are whichever system that pass writes.
         *
         * @param {string} name - The pack name.
         * @returns {string|undefined} Its `system:`, or `undefined`.
         */
        systemOf(name) {
            return byName.get(name)?.system || undefined;
        },

        /**
         * The pack of a type that receives notes declaring none.
         *
         * @param {string} docType - The Foundry document type.
         * @returns {string|undefined} The pack name, or `undefined` when the
         *   type has several packs and none is marked default.
         */
        defaultOf(docType) {
            return defaults.get(docType);
        },
    };
}

const routers = new WeakMap();

/**
 * The router for a resolved configuration, built once per configuration.
 *
 * @param {object} config - A configuration from `defineConfig`.
 * @returns {ReturnType<typeof createPackRouter>} Its router.
 */
export function routerFor(config) {
    let router = routers.get(config);
    if (!router) {
        router = createPackRouter(config.packs);
        routers.set(config, router);
    }
    return router;
}

/**
 * The consuming repository's own router — what every module that emits a UUID
 * asks where a note's document lives.
 *
 * An accessor rather than a hoisted constant, so that importing this module
 * needs no configuration (#2). {@link routerFor} keeps one router per
 * configuration object, so repeated calls return the same instance.
 *
 * @returns {ReturnType<typeof createPackRouter>} This repository's router.
 */
export function packRouter() {
    return routerFor(loadPackConfig());
}
