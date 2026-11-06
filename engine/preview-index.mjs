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
 * **What an editor with a content index gives the preview.** {@link previewIndex}
 * turns a package's configuration and its content-index records into the one
 * object {@link module:engine/site-preview.renderPreview} takes as `index`. A
 * preview given it resolves links, embeds, marked text, icons and figure
 * numbers as the website does; a preview without one shows the buffer's source.
 *
 * Build it once per index and reuse it for every render: it holds the link
 * index, the asset address space, the languages' maps and the events of every
 * note.
 *
 * @module
 */

import { addressSlug } from "./content-address.mjs";
import { expandContent } from "./content-expand.mjs";
import { embedRole } from "./content-embeds.mjs";
import { renderImageFigures } from "./content-images.mjs";
import { runContext } from "./content-scripts.mjs";
import { eventNoteIndex } from "./event-fields.mjs";
import { homepageTitle, isHomepage } from "./homepage.mjs";
import { authoredFrontmatter, isNoteRecord, isStub } from "./index-records.mjs";
import { noContentIndexPackages } from "./metadata-index.mjs";
import { isGmNote } from "./note-vocabulary.mjs";
import { assetAddressIndex } from "./art-fields.mjs";
import { assetPathnameKey, pathnameProblem, resolvePathname } from "./pathnames.mjs";
import { buildSiteIndex, resolveInfoboxRef } from "./site-index.mjs";
import { siteBase } from "../content-config.mjs";

/**
 * What a preview reads to render with an index.
 *
 * @typedef {object} PreviewIndex
 * @property {object} runs - The package's languages, faces and maps.
 * @property {object|undefined} icons - The package's icon registry.
 * @property {(src: string) => ({role?: string, width?: number|"", height?: number|""}|undefined)} lookupAsset -
 *   From a picture's address to its asset.
 * @property {(src: string) => string} resolveSrc - From a picture's authored
 *   pathname to the address the website serves it at.
 * @property {(markdown: string, note: {fm: object, file?: string}) => {markdown: string, figures: object[]}} expand -
 *   Expand a buffer's body as the website expands a page: links, embeds,
 *   expressions and figure numbers resolved. A query, which a buffer cannot
 *   answer, is left as written.
 */

/**
 * What a page of the package resolves against, from its content-index records.
 *
 * The site build reads the same answers from its whole tree; this derives
 * them from the records alone, so a single note renders as its page does
 * without the tree. Each note that publishes a page is an entry at the URL
 * the site gives it: the homepage at the package root, a note
 * `site.sections` names at its section, and every other at its address.
 *
 * @param {object} options
 * @param {object} options.config - The resolved package configuration.
 * @param {object[]} options.records - The content index's records.
 * @param {object} [options.foreign] - The dependencies' indexes, as
 *   {@link module:engine/metadata-index.loadForeignIndexes} returns them.
 * @param {(record: object) => object[]|undefined} [options.anchorsOf] - A
 *   note's anchors as its page emits them, where they differ from the
 *   record's: those of its body with its query answers and generated sections
 *   expanded. Absent, or answering nothing, the record's own.
 * @returns {{site: object, assets: object, events: Map<string, object>, runs: object,
 *   pages: Map<string, object>}} The link index, the asset address space,
 *   every note's events, the package's marked-text context, and the record
 *   behind each page by its URL.
 */
export function recordSiteContext({ config, records, foreign, anchorsOf = () => undefined }) {
    const base = siteBase(config);
    const sections = new Map(
        Object.entries(config.site?.sections ?? {}).map(([name, address]) => [address, name]),
    );
    const entries = [];
    const pages = new Map();
    for (const record of records) {
        if (!isNoteRecord(record) || isStub(record)) continue;
        const fm = authoredFrontmatter(record);
        if (isGmNote(fm) || typeof fm.shortcode !== "string" || !fm.shortcode) continue;
        const slug = addressSlug(fm);
        const home = isHomepage(fm);
        const url =
            home ? base
            : sections.has(slug) ? `${base}${sections.get(slug)}/`
            : `${base}${slug}/`;
        pages.set(url, record);
        entries.push({
            kind: "content",
            fm,
            body: "",
            anchors: anchorsOf(record) ?? record.anchors ?? [],
            pkg: record.package ?? config.contentPackage,
            name:
                fm.name?.full ??
                (home ? homepageTitle(fm, config) : (record.file?.name ?? fm.shortcode)),
            url,
        });
    }
    const site = buildSiteIndex(entries, {
        package: config.contentPackage,
        currentDate: config.currentDate,
        foreignIndex: foreign?.index,
        foreignReferences: foreign?.references,
        records,
        noIndexPackages: noContentIndexPackages(config),
    });
    const assets = assetAddressIndex(records, { config, foreign, types: site.contentTypes });
    const events = eventNoteIndex(records, {
        contentPackage: site.contentPackage,
        foreignIndex: foreign?.index,
        dates: site.dateContext,
    });
    const runs = runContext(config, records, {
        referenceName: (target) => resolveInfoboxRef(site, target)?.name,
    });
    return { site, assets, events, runs, pages };
}

/**
 * Build the object a preview with an index renders from.
 *
 * @param {object} options
 * @param {object} options.config - The resolved package configuration.
 * @param {object[]} options.records - The content index's records: every note
 *   and every asset.
 * @param {object} [options.foreign] - The dependencies' indexes, as
 *   {@link module:engine/metadata-index.loadForeignIndexes} returns them.
 *   Omitted, the package links only to itself.
 * @returns {PreviewIndex} The index.
 */
export function previewIndex({ config, records, foreign }) {
    const { site, assets, events, runs } = recordSiteContext({ config, records, foreign });
    const resolveRole = (address) => embedRole(assets, address);
    const webSrc = (src) =>
        pathnameProblem(src) ? src : (resolvePathname(src, config)?.web ?? src);
    const lookupAsset = (src) => {
        const key = assetPathnameKey(src, config);
        return key ? assets?.byPath?.get(key) : undefined;
    };
    return {
        runs,
        icons: config.icons,
        lookupAsset,
        resolveSrc: webSrc,
        expand: (markdown, { fm, file }) => {
            const expanded = expandContent(markdown, {
                target: "web",
                index: site,
                note: { fm, file, source: file || "<buffer>" },
                events,
                resolveRole,
                links: {
                    foreign: foreign?.index,
                    assets,
                    afterLinks: (block) => renderImageFigures(block, webSrc, lookupAsset),
                },
            });
            return { markdown: expanded.markdown, figures: expanded.figures.figures };
        },
    };
}
