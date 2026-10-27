// SPDX-License-Identifier: GPL-3.0-or-later
/** Real template inputs with a consumer-installed, glyph-code-only fonts manifest. */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
export const template = JSON.parse(
    fs.readFileSync(
        new URL("../fixtures/encoding-notes/aelwythi-semaron.json", import.meta.url),
        "utf8",
    ),
);
export const codes = JSON.parse(
    fs.readFileSync(
        new URL("../fixtures/encoding-notes/semaron-codes.json", import.meta.url),
        "utf8",
    ),
);
export const encodingName = "demo-note-doc-aelwsemaronenc";
export const languageNote = {
    type: "skill",
    subType: "language",
    shortcode: "aelw",
    name: { full: "Aelwythi" },
    data: {
        roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        words: [
            {
                form: "say",
                class: "v",
                field: "Words",
                gloss: ["say", "speak"],
                variants: ["saith"],
            },
            { form: "thikke", class: "adj", field: "Words", gloss: "thick" },
        ],
        register: [{ name: "Adwell", tongue: "aelw" }],
    },
};
export const encodingNote = {
    type: "doc",
    subType: "reference",
    shortcode: "aelwsemaronenc",
    name: { full: "Aelwythi in Semaron" },
    data: template,
};
export const templateConfig = {
    packageKind: "documentation",
    contentPackage: "demo",
    paths: { assets: "assets", content: "assets/content" },
    languages: { aelw: { tag: "art-x-aelw", note: "skill-aelw" } },
};
export function installEncodingNote(root: string) {
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "demo",
            version: "0.1.0",
            description: "Demo",
            repository: { type: "git", url: "https://github.com/HeroicLands/demo.git" },
        }),
    );
    const fonts = path.join(root, "node_modules/@heroiclands/fonts");
    fs.mkdirSync(fonts, { recursive: true });
    fs.writeFileSync(
        path.join(fonts, "package.json"),
        JSON.stringify({
            name: "@heroiclands/fonts",
            version: "1.0.0",
            exports: { "./package.json": "./package.json" },
        }),
    );
    fs.writeFileSync(
        path.join(fonts, "fonts.json"),
        JSON.stringify({
            version: 1,
            families: [
                {
                    family: "Semaron Kuriale",
                    class: "hl-semaron-kuriale",
                    direction: "ltr",
                    codepoints: Object.entries(codes).map(([code, text]: any) => ({
                        code,
                        codepoint: `U+${text.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
                    })),
                },
            ],
        }),
    );
    const directory = path.join(root, "assets/content");
    fs.mkdirSync(directory, { recursive: true });
    for (const [file, note] of [
        ["Aelwythi.md", languageNote],
        ["Encoding.md", encodingNote],
    ] as const)
        fs.writeFileSync(
            path.join(directory, file),
            `---\n${YAML.stringify(note)}---\n\n${note.name.full}.\n`,
        );
    fs.writeFileSync(path.join(root, "package-build.config.yaml"), YAML.stringify(templateConfig));
    return {
        config: {
            ...templateConfig,
            rootDir: root,
            paths: { assets: path.join(root, "assets"), content: directory },
        },
        records: [languageNote, encodingNote].map((note, index) => ({
            ...note,
            package: "demo",
            file: { path: index ? "Encoding.md" : "Aelwythi.md" },
        })),
    };
}
