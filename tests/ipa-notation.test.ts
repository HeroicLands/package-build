/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codepointGlyphs } from "../engine/font-outlines.mjs";
import { tableDirectory } from "../engine/pdf-fonts.mjs";
import { checkText, refusalFor } from "../engine/content-charset.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst, bookTypstPreamble } from "../engine/pdf-render.mjs";
import { writeThemeFiles } from "../engine/site-render.mjs";
import { stagePackageBuildAssets } from "../engine/build-assets.mjs";

const ipa = "ˈθɑ.lɔr.nə t͡ʃ ɑ̌ː ɑ̂ː ʱ ʼ";
it("admits explicit phonetic spans and tables without changing ordinary prose", () => {
    expect(checkText(`[${ipa}]{.ipa}`, "guide.md")).toEqual([]);
    expect(checkText(`| Sound |\n| --- |\n| [/${ipa}/]{.ipa} |`, "guide.md")).toEqual([]);
    expect(checkText(ipa, "guide.md").length).toBeGreaterThan(0);
    expect(checkText("[θ]{.ipa} θ", "guide.md")).toMatchObject([{ line: 1, column: 11 }]);
    expect(checkText("😀 [θ]{.ipa} θ", "guide.md")).toMatchObject([{ column: 1 }, { column: 13 }]);
});
it("does not exempt unsupported characters, controls, normalization or malformed markup", () => {
    for (const char of ["😀", "漢", "\u200b", "\u202e", "\u2060", "\u0001", "\u034f"])
        expect(checkText(`[${char}]{.ipa}`, "guide.md")).toHaveLength(1);
    expect(checkText("[e\u0301]{.ipa}", "guide.md")[0].message).toContain("decomposed");
    for (const source of ["[θ]{.ipa", "`[θ]{.ipa}`", "```\n[θ]{.ipa}\n```", "[θ]{.ipa bad=}"])
        expect(checkText(source, "guide.md").length, source).toBeGreaterThan(0);
    expect(checkText("è\u0301", "guide.md")[0].message).toContain("U+0301");
    expect(checkText("`θ`", "guide.md")).toHaveLength(1);
    expect(checkText("```\nθ\n```", "guide.md")).toHaveLength(1);
});
it("recognizes only declared IPA scalar fields in language notes and spelling guides", () => {
    const note = (type: string, extra = "") =>
        `---\ntype: ${type}\nsubType: language\ndata:\n  sounds:\n    letters:\n      - {letters: [sh], kind: consonant, ipa: ʃ, like: ship}\n    finals:\n      - {final: ang, like: sing, ipa: aŋ}\n${extra}---\n`;
    expect(checkText(note("skill"), "guide.md")).toEqual([]);
    expect(checkText(note("doc"), "guide.md")).toEqual([]);
    expect(checkText(note("skill").replace("ipa: aŋ", "ipa: aʃ"), "guide.md")).toEqual([]);
    expect(checkText(note("doc").replace("ipa: aŋ", "ipa: aʃ"), "guide.md")).toHaveLength(1);
    expect(
        checkText(note("skill").replace("type: skill", "type: skill\ntype: doc"), "guide.md")
            .length,
    ).toBeGreaterThan(0);
    expect(checkText(note("lore"), "guide.md").length).toBeGreaterThan(0);
    expect(checkText(note("skill", "  other: {ipa: θ}\n"), "guide.md")).toHaveLength(1);
    expect(checkText(note("skill").replace("like: ship", "like: θ"), "guide.md")).toHaveLength(1);
    expect(checkText(note("skill").replace("ipa: ʃ", "ipa: [ʃ]"), "guide.md")).toHaveLength(1);
    expect(checkText(note("skill").replace("ipa: ʃ", "ipa: 😀"), "guide.md")).toHaveLength(1);
});
it("keeps IPA and English bytes through the shared renderers and selects the phonetic book face", () => {
    const source = `[/${ipa}/]{.ipa} Sounds like father.`;
    for (const target of ["web", "foundry"] as const)
        expect(createRenderer(target).render(source)).toContain(
            `<span class="ipa">/${ipa}/</span> Sounds like father.`,
        );
    expect(markdownToTypst(source)).toContain(
        `#book-span(classes: ("ipa",))[\\/${ipa}/] Sounds like father.`,
    );
    expect(bookTypstPreamble()).toContain('if "ipa" in classes');
    expect(bookTypstPreamble()).toContain(
        'font: "Libertinus Sans", style: "normal", weight: "regular"',
    );
    for (const target of ["web", "foundry"] as const)
        expect(createRenderer(target).render("*[t͡ʃ]{.ipa} Surrounding prose.*")).toContain(
            '<em><span class="ipa">t͡ʃ</span> Surrounding prose.</em>',
        );
});
it("delivers the same phonetic faces and notices to the site and Foundry stage", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ipa-delivery-"));
    try {
        const site = path.join(root, "site");
        writeThemeFiles(site);
        const assets = path.join(root, "assets");
        fs.mkdirSync(assets);
        await stagePackageBuildAssets({
            config: {
                rootDir: root,
                assets: [],
                stageDir: "stage",
                baseStyles: true,
            } as any,
            packConfig: { rootDir: root, paths: { assets }, contentPackage: "demo" } as any,
        });
        for (const dir of [site, path.join(root, "stage")]) {
            for (const name of ["LibertinusSans-Regular.otf", "OFL.txt", "provenance.yaml"])
                expect(fs.readFileSync(path.join(dir, "fonts/package-build-ipa", name))).toEqual(
                    fs.readFileSync(path.join("assets/fonts/libertinus", name)),
                );
            const cssDir = dir === site ? "css" : "styles";
            const entry = dir === site ? "style.css" : "package-build-base.css";
            expect(fs.readFileSync(path.join(dir, cssDir, entry), "utf8")).toContain(
                '@import url("./package-build-ipa.css")',
            );
            const css = fs.readFileSync(path.join(dir, cssDir, "package-build-ipa.css"), "utf8");
            expect(css).toContain("LibertinusSans-Regular.otf");
            expect(css).not.toContain("LibertinusSans-Italic.otf");
            expect(
                fs.existsSync(path.join(dir, "fonts/package-build-ipa/LibertinusSans-Italic.otf")),
            ).toBe(false);
            expect(css).toMatch(/\.ipa\s+\*\s*\{[^}]*font-style:\s*normal/s);
            expect(css).toMatch(/\.ipa\s+\*\s*\{[^}]*font-weight:\s*400/s);
            expect(css).toContain(".ipa");
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

it("covers every phonetic code point the checker admits with the delivered regular face", () => {
    const font = fs.readFileSync("assets/fonts/libertinus/LibertinusSans-Regular.otf");
    const cmap = codepointGlyphs(font, tableDirectory(font).get("cmap")!);
    // Probe the full phonetic blocks, not a second copy of the supported subset.
    const candidates = Array.from({ length: 0x0370 - 0x0250 }, (_, i) => i + 0x0250).concat([
        0x03b2, 0x03b8, 0x03c6, 0x03c7,
    ]);
    const admitted = candidates.filter(
        // Four canonically decomposable combining marks still get NFC findings.
        (cp) =>
            !checkText(`[${String.fromCodePoint(cp)}]{.ipa}`, "coverage.md").some(
                ({ message }) => !message.includes("decomposed"),
            ),
    );
    expect(admitted.length).toBeGreaterThan(250);
    expect(admitted.filter((cp) => !cmap.get(cp))).toEqual([]);
});
it("reports missing phonetic-face coverage for unsupported marked tone bars and modifiers", () => {
    for (const cp of [0x02e5, 0x02e9, 0x02ea, 0x02eb, 0x02ef, 0x02ff]) {
        const char = String.fromCodePoint(cp);
        const marked = checkText(`[${char}]{.ipa}`, "guide.md");
        expect(marked).toHaveLength(1);
        expect(marked[0].message).toContain(
            "not covered by the bundled Libertinus Sans Regular phonetic face",
        );
        expect(marked[0].message).not.toContain("mark phonetic text");
        expect(checkText(char, "guide.md")[0].message).toContain(refusalFor(cp));
    }
    expect(checkText("[ˬ˭ˮ t͡ʃ θɑː]{.ipa}", "guide.md")).toEqual([]);
});

it("cancels inherited Typst emphasis only for phonetic spans, including links and nested emphasis", () => {
    expect(markdownToTypst("*[t͡ʃ]{.ipa} Surrounding prose.*")).toContain(
        '#emph[#book-span(classes: ("ipa",), emphasized: true)[t͡ʃ] Surrounding prose.]',
    );
    expect(markdownToTypst("*[[t͡ʃ](https://example.com)]{.ipa}*")).toContain(
        '#book-span(classes: ("ipa",), emphasized: true)[#link("https://example.com")[t͡ʃ]]',
    );
    expect(markdownToTypst("*[[t͡ʃ]{.ipa .font-sans}](https://example.com)*")).toContain(
        '#book-span(classes: ("ipa", "font-sans"), emphasized: true)[t͡ʃ]',
    );
    expect(markdownToTypst("*[θ]{.ipa} _[t͡ʃ]{.ipa}_*")).toContain(
        '#emph[#book-span(classes: ("ipa",))[t͡ʃ]]',
    );
    expect(markdownToTypst("*Ordinary [words]{.example}.*")).not.toContain("emphasized:");
    expect(bookTypstPreamble()).toContain("if emphasized { styled = emph(styled) }");
});

it.each([
    "[t͡ʃ]{.ipa .emph}",
    "[t͡ʃ]{.ipa .strong}",
    "[*t͡ʃ*]{.ipa}",
    "[**t͡ʃ**]{.ipa}",
    "[***t͡ʃ***]{.ipa}",
    "[[t͡ʃ]{.emph}]{.ipa}",
    "[[t͡ʃ]{.strong}]{.ipa}",
    "[t͡ʃ]{.ipa .font-serif}",
    "[[t͡ʃ]{.font-serif}]{.ipa}",
    "[`t͡ʃ`]{.ipa}",
])("keeps phonetic dispatch through nested or combined styles: %s", (source) => {
    expect(checkText(source, "guide.md")).toEqual([]);
    const typst = markdownToTypst(source);
    expect(typst).toContain("#book-span(");
    expect(typst).toContain('"ipa"');
    expect(typst).toContain("t͡ʃ");
    expect(typst).not.toMatch(/#(?:emph|strong|raw)\[/);
});
it("keeps competing fonts out of the phonetic book branch and covers HTML descendants", () => {
    expect(bookTypstPreamble()).toContain("let styled = if phonetic { body } else");
    const css = fs.readFileSync("assets/styles/phonetic.css", "utf8");
    expect(css).toMatch(/\.ipa\s*,\s*\.ipa\s+\*/);
    expect(css).toContain("font-synthesis: none");
    expect(css).toContain("font-style: normal !important");
    expect(css).toContain("font-weight: 400 !important");
});

it("keeps code inside a phonetic span literal without reparsing Markdown", () => {
    const source = "[`*θ*`]{.ipa}";
    expect(markdownToTypst(source)).toContain("\\*θ\\*");
    expect(markdownToTypst(source)).not.toContain("#emph[");
    for (const target of ["web", "foundry"] as const)
        expect(createRenderer(target).render(source)).toContain("<code>*θ*</code>");
});
