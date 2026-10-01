// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { buildJournalEntry, Journals } from "../engine/journals.mjs";
import { noteInfoboxes } from "../engine/infobox-registry.mjs";
import { infoboxesToHtml, linkToUuid } from "../engine/infobox-render.mjs";

const id = "0123456789abcdef";
const boxes = noteInfoboxes({ type: "weapongear", name: { full: "Spear" }, dnd5e: {} });
const infoboxes = boxes.map((box) => ({
    id: box.id,
    name: `${
        box.id === "note" ? "Properties"
        : box.id === "sohl" ? "SoHL"
        : "HM3"
    } Infobox`,
    html: infoboxesToHtml([box], { link: linkToUuid }),
}));
const entry = (markdown: string) =>
    buildJournalEntry({
        id,
        name: "Spear",
        markdown,
        infoboxes,
        notice: "<p>Draft notice.</p>",
    });

describe("generated journal infobox pages", () => {
    it("appends every emitted box separately after authored pages", () => {
        const pages = entry("Opening image.\n\n# Description\nAuthored prose.").pages;
        expect(pages.map((page) => page.name)).toEqual([
            "Introduction",
            "Description",
            "Properties Infobox",
            "SoHL Infobox",
            "HM3 Infobox",
        ]);
        expect(pages[0].text.content).toContain("Draft notice.");
        expect(pages[0].text.content).not.toContain('class="infobox');
        for (const [index, box] of infoboxes.entries()) {
            expect(pages[index + 2].text.content).toBe(box.html);
            expect(pages[index + 2]._key).toBe(`!journal.pages!${id}.${pages[index + 2]._id}`);
        }
        expect(boxes.map((box) => box.id)).not.toContain("dnd5e");
    });

    it("uses the compiler's emitted boxes and exact page names", () => {
        const compiled = Journals.prototype.buildEntry.call(
            {
                folderResolver: () => null,
                linkIndex: undefined,
                router: undefined,
                stats: {},
            },
            { id, type: "weapongear", name: { full: "Spear" }, dnd5e: {} },
            "Authored prose.",
        );
        expect(compiled.pages.slice(1).map((page) => page.name)).toEqual([
            "Properties Infobox",
            "SoHL Infobox",
            "HM3 Infobox",
        ]);
        expect(compiled.pages.slice(1).map((page) => page.text.content)).toEqual(
            infoboxes.map((box) => box.html),
        );
    });

    it("keeps generated identities stable and distinct from authored names and anchors", () => {
        const first = entry("Prose.").pages.slice(1);
        const changed = entry(
            "# Properties Infobox\nAuthored properties.\n\n# Other {#infobox-note}\nMore prose.",
        ).pages;
        expect(changed.slice(2).map((page) => page._id)).toEqual(first.map((page) => page._id));
        expect(new Set(changed.map((page) => page._id)).size).toBe(changed.length);
    });
});
