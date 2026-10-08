/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The Foundry page a `:::figure` fence begins.
 *
 * `Journals.buildEntry` receives a note's markdown after wikilink and embed
 * conversion, so every fixture here is written in that already-converted
 * shape — `![alt](src)` — rather than in the authored `![[...]]` form: that
 * is what `buildJournalEntry` actually sees in a real compile.
 */

import { describe, it, expect } from "vitest";

import { buildJournalEntry } from "../engine/journals.mjs";

/** An image this repository's own default pack config resolves. */
const THORN = "sohl/assets/images/other/thorn.webp";
const ANVIL_ICON = "sohl/assets/icons/other/anvil.svg";
const SECOND_IMAGE = "sohl/assets/images/other/second.webp";
const HOWL = "sohl/assets/audio/howl.mp3";

function entryFor(markdown: string) {
    return buildJournalEntry({ id: "0123456789abcdef", name: "Fixture", markdown });
}

describe("a single-asset fence with a plain caption", () => {
    it("emits an image page for an image embed, named for its number", () => {
        const [page] = entryFor(`:@ The great beast. {#thorn}\n\n![Thorn](${THORN})`).pages;
        expect(page.type).toBe("image");
        expect(page.name).toBe("Figure 1");
        expect(page.src).toBe("systems/sohl/assets/images/other/thorn.webp");
        expect(page.image.caption).toBe("The great beast.");
    });

    it("emits an image page for an SVG icon embed", () => {
        const [page] = entryFor(`:@ A worn anvil. {#anvil}\n\n![An anvil](${ANVIL_ICON})`).pages;
        expect(page.type).toBe("image");
        expect(page.src).toBe("systems/sohl/assets/icons/other/anvil.svg");
        expect(page.image.caption).toBe("A worn anvil.");
    });
});

describe("a caption without attributes", () => {
    it("names its page by its number and carries the caption", () => {
        const [page] = entryFor(`:@ Caption.\n\n![Thorn](${THORN})`).pages;
        expect(page.type).toBe("image");
        expect(page.name).toBe("Figure 1");
        expect(page.image.caption).toBe("Caption.");
    });
});

describe("a grouped fence", () => {
    it("emits a text page, an image page holding one src", () => {
        const [page] = entryFor(
            `:@ Two together. {#plate type=figure}\n\n:::\n![A](${THORN})\n\n![B](${SECOND_IMAGE})\n:::`,
        ).pages;
        expect(page.type).toBe("text");
        expect(page.src).toBeUndefined();
        expect(page.text.content).toContain("Two together.");
    });
});

describe("an audio embed", () => {
    it("emits a text page, there being no audio page type", () => {
        const [page] = entryFor(`:@ Heard at dusk. {#howl}\n\n![A wolf's call](${HOWL})`).pages;
        expect(page.type).toBe("text");
        expect(page.text.content).toContain("Heard at dusk.");
    });
});

describe("a single-asset fence whose caption carries inline markup", () => {
    it("stays a text page, keeping the markup intact", () => {
        const [page] = entryFor(
            `:@ The beast, as drawn by [Hávard](sohl.person-havard). {#marked}\n\n![Thorn](${THORN})`,
        ).pages;
        expect(page.type).toBe("text");
        expect(page.text.content).toContain('<a href="sohl.person-havard">Hávard</a>');
    });
});

describe("a figure with no id", () => {
    it("takes its per-note number on its page, not a per-page recount", () => {
        const markdown =
            `:@ The great beast. {#thorn}\n\n![Thorn](${THORN})\n\n` +
            `:@ Two together. {type=figure}\n\n:::\n![A](${THORN})\n\n![B](${SECOND_IMAGE})\n:::`;
        const [first, second] = entryFor(markdown).pages;
        expect(first.name).toBe("Figure 1");
        expect(second.name).toBe("Figure 2");
        // The second figure holds no id, so nothing but its own page content
        // carries its number — and that page is split off on its own,
        // isolated from the first figure, so a render that recounted locally
        // would mislabel it "Figure 1" a second time.
        expect(second.type).toBe("text");
        expect(second.text.content).toContain("Figure 2");
        expect(second.text.content).not.toContain("Figure 1");
    });
});

describe("a figure followed by prose", () => {
    it("keeps the figure's page to the figure, and resumes the prose after it", () => {
        const markdown = `:@ Caption. {#thorn}\n\n![Thorn](${THORN})\n\nMore about Thorn.`;
        const [figure, after] = entryFor(markdown).pages;
        expect(figure.type).toBe("image");
        expect(figure.name).toBe("Figure 1");
        expect(after.type).toBe("text");
        expect(after.name).toBe("Introduction");
        expect(after.title.show).toBe(false);
        expect(after.text.content).toContain("More about Thorn.");
    });
});

/** A poem captioned mid-section, as a content package writes an excerpt. */
const POEM = ["```poetry {form=epic lang=en}", "Hear now, hearth keepers.", "```"].join("\n");

describe("a captioned item in the middle of a section", () => {
    const markdown = [
        "# The Pantheon {#pantheon}",
        "",
        "The gods of the north.",
        "",
        ": The Last Muster {#muster}",
        "",
        POEM,
        "",
        "After the poem, the pantheon resumes.",
        "",
        "## The Lesser Gods",
        "",
        "Smaller altars.",
        "",
        "# Worship",
        "",
        "How they are honoured.",
    ].join("\n");
    const pages = entryFor(markdown).pages;
    const byName = (name: string) => pages.filter((page: any) => page.name === name);

    it("gives the item a page holding the item alone", () => {
        const [muster] = byName("The Last Muster");
        expect(muster.text.content).toContain("Hear now, hearth keepers.");
        expect(muster.text.content).not.toContain("the pantheon resumes");
        expect(muster.text.content).not.toContain("Smaller altars");
    });

    it("resumes the section in a continuation page under the section's own name", () => {
        expect(pages.map((page: any) => page.name)).toEqual([
            "The Pantheon",
            "The Last Muster",
            "The Pantheon",
            "Worship",
        ]);
        const [section, continuation] = byName("The Pantheon");
        expect(section.text.content).toContain("The gods of the north.");
        expect(continuation.text.content).toContain("the pantheon resumes");
        expect(continuation.text.content).toContain("Smaller altars");
        expect(continuation.title).toEqual({ show: false, level: section.title.level });
    });

    it("keys the continuation on the item it follows, apart from every other page", () => {
        const ids = pages.map((page: any) => page._id);
        expect(new Set(ids).size).toBe(ids.length);
        const shifted = entryFor(`# Prelude\n\nFirst.\n\n${markdown}`).pages;
        const continuation = (list: any[]) =>
            list.filter((page) => page.name === "The Pantheon")[1]._id;
        expect(continuation(shifted)).toBe(continuation(pages));
    });

    it("opens no continuation when the next page starts straight after the item", () => {
        const names = entryFor(
            ["# A", "", "Text.", "", ": Verse {#verse}", "", POEM, "", "# B", "", "More."].join(
                "\n",
            ),
        ).pages.map((page: any) => page.name);
        expect(names).toEqual(["A", "Verse", "B"]);
    });

    it("withholds a continuation of a withheld section", () => {
        const secret = entryFor(
            [
                "# Rites {.secret}",
                "",
                "Hidden.",
                "",
                ": Verse {#verse}",
                "",
                POEM,
                "",
                "Still hidden.",
            ].join("\n"),
        ).pages;
        const continuation = secret[2];
        expect(continuation.name).toBe("Rites");
        expect(secret[0].ownership).toBeDefined();
        expect(continuation.ownership).toEqual(secret[0].ownership);
    });

    it("withholds an item inside a withheld section, and the continuation after it", () => {
        const pages = entryFor(
            [
                "# Rites {.secret}",
                "",
                "Hidden.",
                "",
                ": Verse {#verse}",
                "",
                POEM,
                "",
                "Still hidden.",
            ].join("\n"),
        ).pages;
        expect(pages.map((page: any) => page.name)).toEqual(["Rites", "Verse", "Rites"]);
        expect(pages[0].ownership).toBeDefined();
        expect(pages[1].ownership).toEqual(pages[0].ownership);
        expect(pages[2].ownership).toEqual(pages[0].ownership);
    });

    it("states no ownership for an item in an ordinary section or the lead region", () => {
        const pages = entryFor(
            [
                "Lead.",
                "",
                ": First {#first}",
                "",
                POEM,
                "",
                "# Open",
                "",
                ": Second {#second}",
                "",
                POEM,
            ].join("\n"),
        ).pages;
        expect(pages.length).toBeGreaterThan(2);
        for (const page of pages) expect(page.ownership).toBeUndefined();
    });

    it("does not carry a withheld section's withholding into the next section", () => {
        const pages = entryFor(
            [
                "# Rites {.secret}",
                "",
                ": Verse {#verse}",
                "",
                POEM,
                "",
                "# Open",
                "",
                "Plain.",
                "",
                ": Other {#other}",
                "",
                POEM,
            ].join("\n"),
        ).pages;
        const open = pages.filter((page: any) => page.name !== "Rites" && page.name !== "Verse");
        expect(open.length).toBeGreaterThan(1);
        for (const page of open) expect(page.ownership).toBeUndefined();
        expect(pages.find((page: any) => page.name === "Verse").ownership).toBeDefined();
    });
});

describe("a caption carrying a link", () => {
    const LINK =
        '<span class="sohl-draft-link" title="Draft — not yet written">' +
        "@UUID[Compendium.thalorna.journals.JournalEntry.a79088ee147cd796]{The Swearing Under the Baobab}</span>";

    it("names its page with the caption's visible text, and keeps the link in the page", () => {
        const [, page] = entryFor(`Lead.\n\n: From ${LINK} {#swearing-witness}\n\n${POEM}`).pages;
        expect(page.name).toBe("From The Swearing Under the Baobab");
        expect(page.text.content).toContain(
            "@UUID[Compendium.thalorna.journals.JournalEntry.a79088ee147cd796]",
        );
    });

    it("names its page with the text of emphasis and Markdown links", () => {
        const [page] = entryFor(
            `: The *beast*, drawn by [Hávard](sohl.person-havard)\n\n${POEM}`,
        ).pages;
        expect(page.name).toBe("The beast, drawn by Hávard");
    });

    it("keeps a numbered item's name to its number", () => {
        const [page] = entryFor(
            `:@ The beast, as drawn by [Hávard](sohl.person-havard). {#marked}\n\n![Thorn](${THORN})`,
        ).pages;
        expect(page.name).toBe("Figure 1");
    });
});
