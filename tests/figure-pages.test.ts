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
            `:@ Two together. {#plate}\n\n![A](${THORN})\n\n![B](${SECOND_IMAGE})`,
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
            `:@ Two together.\n\n![A](${THORN})\n\n![B](${SECOND_IMAGE})`;
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

describe("a figure followed by trailing prose on the same split", () => {
    it("stays a text page — an image page has nowhere to carry the prose", () => {
        const markdown = `:@ Caption. {#thorn}\n\n![Thorn](${THORN})\n\nMore about Thorn.`;
        const [page] = entryFor(markdown).pages;
        expect(page.type).toBe("text");
        expect(page.text.content).toContain("More about Thorn.");
    });
});
