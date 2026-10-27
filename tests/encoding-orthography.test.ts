// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { installEncodingNote, encodingName } from "./helpers/encoding-note.js";
import { runContext } from "../engine/content-scripts.mjs";
import { encodeText } from "../engine/encoding.mjs";
import { checkEncodingLexicon } from "../engine/encoding-lexicon.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";
it("checks unused authoritative words and names without allowing native entries to bypass Roman rules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-orthography-"));
    try {
        const { config, records } = installEncodingNote(root);
        const bad = {
            ...records[0],
            data: {
                ...records[0].data,
                words: [
                    {
                        form: "c",
                        class: "n",
                        field: "Words",
                        gloss: "unused",
                        variants: ["x"],
                        native: [{ enc: encodingName, text: "\u{F0230}" }],
                    },
                ],
                names: {
                    pattern: "{given} {family}",
                    given: { male: ["Say", "Adwell"] },
                    family: ["Say Adwell", "cove"],
                },
                elements: [{ form: "-say", examples: ["Sáy", "xarin"] }],
                register: [{ name: "xil", tongue: "aelw" }],
            },
        };
        const context = runContext(config, [bad, records[1]]);
        expect(
            encodeWithLanguage(context.encodings.get(encodingName), "c", {
                lexicon: { language: "aelw", data: bad.data },
            }).text,
        ).toBe("\u{F0230}");
        const note = {
            file: path.join(root, "assets/content/Aelwythi.md"),
            fm: bad,
            raw: `---\n${YAML.stringify(bad)}---\n`,
        };
        expect(
            encodeWithLanguage(context.encodings.get(encodingName), "x", {
                lexicon: { language: "aelw", data: bad.data },
            }),
        ).toMatchObject({ text: "", findings: [{ offset: 0 }] });
        const findings = checkEncodingLexicon(note, context);
        expect(findings).toHaveLength(4);
        for (const form of ["x", "cove", "xarin", "xil"])
            expect(
                findings.some((f) =>
                    f.message.startsWith(`\`${form}\` is not valid Roman spelling`),
                ),
            ).toBe(true);
        expect(findings.every((f) => f.file === note.file && f.line > 1 && f.column > 0)).toBe(
            true,
        );
        expect(checkEncodingLexicon(note, { ...context, encodings: new Map() })).toEqual([]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
it.each([{}, { a: "ANKRON_MIN" }])(
    "accepts authoritative native words when ordinary mapping coverage is partial: %j",
    (mappings) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-native-orthography-"));
        try {
            const { config, records } = installEncodingNote(root);
            const native = {
                form: "bb",
                class: "n",
                field: "Words",
                gloss: "a native word",
                native: [{ enc: encodingName, text: "\u{F0231}" }],
            };
            const language = { ...records[0], data: { words: [native], roman: "ab" } };
            const encoding = {
                ...records[1],
                data: {
                    language: "aelw",
                    font: "semaron-kuriale",
                    accepts: ["a-z"],
                    mappings,
                    rules: { normalization: "NFC", matching: "longest-first" },
                },
            };
            const context = runContext(config, [language, encoding]);
            expect(context.encodingFindings).toEqual([]);
            const note = {
                file: path.join(root, "assets/content/Aelwythi.md"),
                fm: language,
                raw: `---\n${YAML.stringify(language)}---\n`,
            };
            expect(checkEncodingLexicon(note, context)).toEqual([]);
            expect(
                encodeWithLanguage(context.encodings.get(encodingName), "bb", {
                    lexicon: { language: "aelw", data: language.data },
                }),
            ).toMatchObject({ text: "\u{F0231}", findings: [] });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
);

it("excludes English translation labels from own-language orthography and name recovery", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-translation-register-"));
    try {
        const { config, records } = installEncodingNote(root);
        const language = {
            ...records[0],
            data: {
                ...records[0].data,
                words: [],
                register: [
                    { name: "Say", tongue: "aelw" },
                    { name: "xil", tongue: "aelw" },
                    { name: "Long-Watcher's Sayings", tongue: "translation" },
                    { name: "Bad", tongue: "translation" },
                ],
            },
        };
        const context = runContext(config, [language, records[1]]);
        const note = {
            file: path.join(root, "assets/content/Aelwythi.md"),
            fm: language,
            raw: `---\n${YAML.stringify(language)}---\n`,
        };
        const findings = checkEncodingLexicon(note, context);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/^`xil` is not valid Roman spelling/);
        const enc = context.encodings.get(encodingName),
            lexicon = { language: "aelw", data: language.data };
        expect(decodeWithLanguage(enc, encodeText(enc, "Say"), { lexicon })).toMatchObject({
            text: "{say}",
            findings: [],
        });
        const translated = decodeWithLanguage(enc, encodeText(enc, "Bad"), { lexicon });
        expect(translated.text).toBe("Bad");
        expect(translated.findings).toHaveLength(1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
