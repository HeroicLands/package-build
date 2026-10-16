/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { collectAnchors } from "../engine/anchors.mjs";
import { renderSpans } from "../engine/content-spans.mjs";
import { DICTIONARY_COLUMNS, dictionaryEntryAnchor } from "../engine/dictionary-rows.mjs";
import { renderDictionary } from "../engine/dictionary-layout.mjs";
import { anchorsOf } from "../engine/foundry-entries.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { buildPages, journalPageId, splitPages } from "../engine/journals.mjs";
import { buildWikilinkIndex, convertWikilinks } from "../engine/wikilinks.mjs";

const language = "demo-note-skill-tongue";
const id = "abcdefghijklmnop";
const uuid = `Compendium.demo.journals.JournalEntry.${id}`;
const name = "zethu";
const anchor = dictionaryEntryAnchor(language, name);
const dictionary = renderDictionary({
    columns: [...DICTIONARY_COLUMNS],
    rows: [{ language, name, class: "n", senses: [{ text: "writing", bodies: [] }], usage: [] }],
});
const body = `# Words {#dictionary}\n\nA list of words.\n\n${dictionary}`;

describe("a dictionary word's native Foundry target", () => {
    it("keeps the word fragment on its containing page UUID", () => {
        const targets = anchorsOf(uuid, id, body, "Tongue");
        const [page] = splitPages(body, "Tongue");
        const containing = `${uuid}.JournalEntryPage.${journalPageId(id, page)}`;
        expect(targets.dictionary).toBe(containing);
        expect(targets[anchor]).toBe(`${containing}#${anchor}`);
        const index = buildWikilinkIndex(
            [
                {
                    type: "doc",
                    shortcode: "tongue",
                    id,
                    anchors: new Set(collectAnchors(body).map((entry) => entry.slug)),
                    anchorUuids: targets,
                },
            ],
            "demo",
        );
        const resolved = convertWikilinks(`[[doc-tongue#${anchor}|${name}]]`, {
            type: "doc",
            id: "reader",
            index,
        });
        expect(resolved.unresolved).toEqual([]);
        expect(resolved.markdown).toBe(`@UUID[${containing}#${anchor}]{${name}}`);
    });

    it("emits a native heading at the word without splitting its containing page or nesting a heading in a paragraph", () => {
        const [before] = splitPages("# Words {#dictionary}\n\nA list of words.", "Tongue");
        const raw = splitPages(body, "Tongue");
        expect(raw).toHaveLength(1);
        expect(journalPageId(id, raw[0])).toBe(journalPageId(id, before));
        const [page] = buildPages(raw, id, "Tongue");
        const html = page.text?.content ?? "";
        expect(html).toMatch(
            new RegExp(`<h6\\b[^>]*id="${anchor}"[^>]*><strong>${name}</strong></h6>`),
        );
        expect(html).toMatch(new RegExp(`<div\\b[^>]*>\\s*<h6\\b[^>]*id="${anchor}"`));
        expect(html).not.toMatch(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<h[1-6]\b/);
    });

    it("keeps web and book word spans and ordinary authored Foundry spans as spans", () => {
        const web = renderSpans(dictionary).markdown;
        expect(web).toContain(`<span id="${anchor}"`);
        expect(web).not.toContain("<h6");
        const authored = "# Words {#dictionary}\n\nAn [ordinary span]{#ordinary}.";
        const targets = anchorsOf(uuid, id, authored, "Tongue");
        expect(targets.ordinary).toBe(targets.dictionary);
        expect(renderFoundryMarkdown(authored)).toContain(
            '<span id="ordinary">ordinary span</span>',
        );
    });
});
