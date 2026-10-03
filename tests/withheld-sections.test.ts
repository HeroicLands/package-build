// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ClassicLevel } from "classic-level";
import { describe, expect, it } from "vitest";

import { compilePacks } from "../engine/compendiums.mjs";
import { renderWithheldSections } from "../engine/content-blocks.mjs";
import { withheldSections } from "../engine/heading-attributes.mjs";
import { buildPages, splitPages } from "../engine/journals.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const body = [
    "# The Taproom {#taproom}",
    "",
    "Ale, and a fire kept lit.",
    "",
    "# The Cellar {#cellar .secret}",
    "",
    "The contraband is behind the false wall.",
    "",
    ":::secret",
    "The cellarer keeps a tally.",
    ":::",
    "",
    "# The Yard {#yard}",
    "",
    "Carts stand overnight.",
    "",
].join("\n");

describe("a .secret heading withholds the section it opens", () => {
    it("gives the page to the GM alone, and leaves the others inheriting", () => {
        const pages = buildPages(splitPages(body), "aaaaaaaaaaaaaaaa", "Inn", []);
        const withheld = pages.find((page) => page.name === "The Cellar");
        expect(withheld?.ownership).toEqual({ default: 0 });
        for (const page of pages.filter((p) => p.name !== "The Cellar")) {
            expect(page).not.toHaveProperty("ownership");
        }
    });

    it("keeps the heading's anchor, so a link still resolves to it", () => {
        const page = splitPages(body).find((p) => p.name === "The Cellar");
        expect(page?.anchorSlug).toBe("cellar");
    });

    it("wraps the heading and its section in the spoiler on the web", () => {
        const web = renderWithheldSections(body);
        expect(web).toContain('<details class="secret">');
        expect(web).toContain('<summary class="secret">Secret</summary>');
        // The heading itself is inside the disclosure, with its attributes
        // intact for the page's own renderer to read.
        const open = web.indexOf("<details");
        const close = web.indexOf("</details>");
        expect(web.slice(open, close)).toContain("# The Cellar {#cellar .secret}");
        expect(web.slice(open, close)).toContain("The contraband is behind the false wall.");
        expect(web.slice(open, close)).not.toContain("The Yard");
    });

    it("sets the heading and its section in the labelled block in the book", () => {
        const typst = markdownToTypst(body);
        const box = typst.indexOf('rgb("#f2eefb")');
        expect(box).toBeGreaterThan(-1);
        expect(typst.slice(box)).toContain("[! Secret]");
        expect(typst.slice(box)).toContain("[The Cellar]");
        // A `:::secret` block inside the section is still a block of its own,
        // so the section's box and the block's box are two boxes.
        expect(typst.split('rgb("#f2eefb")').length - 1).toBe(2);
    });

    it("reports a .secret heading that opens no page, at its own line", () => {
        const misplaced = "# A Room {#room}\n\n## A corner {.secret}\n\nNothing here.\n";
        expect(withheldSections(misplaced).errors).toEqual([
            {
                line: 3,
                column: 13,
                message:
                    ".secret withholds the page a heading opens, and this heading opens none — " +
                    "give it an anchor, or raise it to the top level",
            },
        ]);
    });

    /**
     * The pack cleaner resets every page's ownership to inherit as a matter of
     * course, so the only reading that proves anything is the one taken out of
     * the compiled pack rather than off the page the builder returned.
     */
    it("ships the ownership in the compiled pack", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "withheld-"));
        const prebuilt = path.join(root, "assets/packs/inns");
        fs.mkdirSync(prebuilt, { recursive: true });
        const entryId = "bbbbbbbbbbbbbbbb";
        const pages = buildPages(splitPages(body), entryId, "Inn", []);
        fs.writeFileSync(
            path.join(prebuilt, `Inn_${entryId}.json`),
            JSON.stringify({
                _id: entryId,
                _key: `!journal!${entryId}`,
                name: "Inn",
                pages,
                folder: null,
                ownership: { default: -1 },
            }),
        );

        const stage = path.join(root, "build/stage/packs");
        await compilePacks({
            config: {
                packs: [
                    {
                        name: "inns",
                        type: "JournalEntry",
                        label: "Inns",
                        private: false,
                        companions: [],
                        prebuilt,
                        system: null,
                    },
                ],
                packDirectories: ["inns"],
                paths: {
                    content: path.join(root, "assets/content"),
                    packJson: path.join(root, "build/packs-json"),
                    stage,
                },
                stats: { systemId: null, lastModifiedBy: "withheld00000000" },
            },
            stageDest: stage,
        });

        const db = new ClassicLevel(path.join(stage, "inns"), {
            keyEncoding: "utf8",
            valueEncoding: "json",
            createIfMissing: false,
        });
        await db.open();
        try {
            const shipped = new Map<string, any>();
            for await (const [key, value] of db.iterator()) shipped.set(key, value);
            const cellar = pages.find((page) => page.name === "The Cellar");
            const taproom = pages.find((page) => page.name === "The Taproom");
            expect(shipped.get(cellar!._key)?.ownership).toEqual({ default: 0 });
            // Stating nothing is how a page inherits, so the pages around it
            // ship without an ownership at all.
            expect(shipped.get(taproom!._key)).not.toHaveProperty("ownership");
        } finally {
            await db.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 30_000);
});
