import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import {
    SHARED_SOUND_CONTROLS,
    SHARED_SOUND_CODES,
    SHARED_SOUNDS,
    STANDARD_CONTROLS,
    STANDARD_ROWS,
    validateGuideSounds,
} from "../engine/encoding-standard.mjs";

const guidePath = fileURLToPath(
    new URL("./fixtures/sound-guides/Pronouncing_Thalorna.md", import.meta.url),
);
// Actual consumer guide; its checksum pins the source used by this fixture.
const guideSha256 = "8a97d062f666cc107561ca119041e2b95ebb25e19bd94f4d266eb59efb68fdae";

function guideLetters(text: string) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!frontmatter) throw new Error("Guide frontmatter is missing");
    return YAML.parse(frontmatter[1]).data.sounds.letters;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("shared sound registry", () => {
    it("covers the sounds read from the pinned consumer guide", () => {
        const text = readFileSync(process.env.HEROICLANDS_SOUND_GUIDE || guidePath, "utf8");
        if (!process.env.HEROICLANDS_SOUND_GUIDE) expect(sha256(text)).toBe(guideSha256);
        const letters = guideLetters(text);
        expect(validateGuideSounds(letters)).toEqual([]);
        expect(validateGuideSounds([...letters].reverse())).toEqual([]);
        for (const row of letters) {
            const entry = SHARED_SOUNDS[row.ipa];
            expect(entry.roman).toBe(row.letters[0]);
            expect(entry.kind).toBe(row.kind);
            expect([...entry.invisible]).toHaveLength(1);
        }
    });

    it("reports a repeated IPA and a sound without an allocation", () => {
        const letters = guideLetters(readFileSync(guidePath, "utf8"));
        expect(validateGuideSounds([...letters, letters[0]])).toContain(
            `data.sounds.letters[${letters.length}] repeats IPA /${letters[0].ipa}/`,
        );
        expect(
            validateGuideSounds([...letters, { letters: ["new"], ipa: "unallocated" }]),
        ).toContain(
            `data.sounds.letters[${letters.length}] has no shared invisible form for /unallocated/`,
        );
    });

    it("pins shared allocations and all compatibility characters", () => {
        const allocation = Object.entries(SHARED_SOUNDS)
            .map(([ipa, entry]) => [ipa, entry.roman, entry.invisible.codePointAt(0)])
            .sort(([a], [b]) => String(a).localeCompare(String(b), "en"));
        expect(allocation).toHaveLength(49);
        expect(sha256(JSON.stringify(allocation))).toBe(
            "18bee2964c6754febdb555b6c50a5e3b9e4d18cb6a7f40eb9a7839f845d80a76",
        );
        expect(SHARED_SOUND_CONTROLS).toEqual({
            stress: "\u{E0114}",
            legacyShort: "\u{E0116}",
            compoundBoundary: "\u{E0117}",
            toneRising: "\u{E0149}",
            toneFalling: "\u{E014A}",
        });
        expect(STANDARD_ROWS).toEqual([
            [".", "\u{E0100}"],
            ["?", "\u{E0101}"],
            ["‼", "\u{E0102}"],
            ["!", "\u{E0103}"],
            { from: "^", to: "\u{E0104}", at: "line-start" },
            [",", "\u{E0105}"],
            ["«", "\u{E0106}"],
            ["»", "\u{E0107}"],
            ["‹", "\u{E0108}"],
            ["›", "\u{E0109}"],
            ["—", "\u{E010A}"],
            ["…", "\u{E010B}"],
            ["/", "\u{E010C}"],
            ["\\/", "\u{E010F}"],
            ["{", "\u{E0110}"],
            ["}", "\u{E0111}"],
        ]);
        expect(STANDARD_CONTROLS).toEqual({
            verseStanza: "\u{E010D}",
            verseCanto: "\u{E010E}",
            wordSeparator: " ",
            literalOpen: "\u{E0112}",
            literalClose: "\u{E0113}",
            literalEscape: "\u{E0115}",
        });
    });
});

it("gives each actual guide sound a unique stable font-code alias", () => {
    const letters = guideLetters(readFileSync(guidePath, "utf8"));
    const codes = letters.map((row) => SHARED_SOUNDS[row.ipa].code);
    expect(new Set(codes).size).toBe(letters.length);
    for (const row of letters) {
        const sound = SHARED_SOUNDS[row.ipa];
        expect(SHARED_SOUND_CODES[sound.code]).toBe(sound.invisible);
    }
    expect(SHARED_SOUND_CODES.TONE_RISING).toBe("\u{E0149}");
    expect(SHARED_SOUND_CODES.TONE_FALLING).toBe("\u{E014A}");
    expect(new Set(Object.values(SHARED_SOUND_CODES)).size).toBe(54);
    for (const code of codes) expect(code).toMatch(/^SOUND_[A-Z]+(?:_GRAVE)?$/);
    expect(SHARED_SOUNDS["aɪ"].code).toBe("SOUND_AI");
    expect(SHARED_SOUNDS["æ"].code).toBe("SOUND_A_GRAVE");
    expect(SHARED_SOUNDS["ʔ"].code).toBe("SOUND_CATCH");
});
