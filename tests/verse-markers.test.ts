/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { parseVerse, scanVerse, verseStanzas, renderVerse } from "../engine/content-verse.mjs";
const fence = (...lines: string[]) => ["```verse", ...lines, "```"].join("\n");
describe("verse line markers and language runs", () => {
    it("takes indentation from periods in the first span and leaves later periods literal", () => {
        const body = "   [..The gate]{lang=en} [..salve]{lang=la}/\n  Plain [..word]{lang=la}";
        expect(verseStanzas(body)).toEqual([
            [
                { text: "[The gate]{lang=en} [..salve]{lang=la}", level: 2 },
                { text: "Plain [..word]{lang=la}", level: 0 },
            ],
        ]);
        expect(renderVerse(fence(body)).markdown).toContain('class="verse-line i2"');
    });
    it("ignores leading spaces and counts periods after logical line endings", () => {
        expect(verseStanzas("   Base/\n     .One/..Two")).toEqual([
            [
                { text: "Base", level: 0 },
                { text: "One", level: 1 },
                { text: "Two", level: 2 },
            ],
        ]);
    });
    it("preserves indentation in the equivalent physical and compact forms", () => {
        expect(verseStanzas("To be,/\n..that is!//")).toEqual(verseStanzas("To be,/..that is!//"));
    });
    it("keeps blank stanza groups and a separate canto break", () => {
        const source = fence("One", "", "Two", "***", "Three");
        expect(scanVerse(source).errors).toEqual([]);
        expect(parseVerse("One\n\nTwo\n***\nThree").cantos.map((c) => c.stanzas.length)).toEqual([
            2, 1,
        ]);
        expect(renderVerse(source).markdown).toContain('class="verse-canto-break"');
    });
});
