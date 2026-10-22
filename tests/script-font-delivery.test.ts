/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The fonts reach every target, or none.** With `@heroiclands/fonts`
 * installed and a note setting text in one of its faces, the site, the Foundry
 * module and the book each receive exactly what they use; without either,
 * nothing ships and nothing links to it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BASE_STYLESHEET_DEST, withBaseStyle } from "../engine/base-styles.mjs";
import { typstArgs, typstFontArgs } from "../engine/pdf-build.mjs";
import {
    checkScriptFonts,
    copyScriptFonts,
    facesUsed,
    stagedStylesheet,
    scriptFontFiles,
    siteFontsParam,
    typstScriptFontPath,
    withScriptFontStyle,
} from "../engine/script-font-delivery.mjs";
import { resolveScriptFonts } from "../engine/script-fonts.mjs";
import { siteSettings } from "../engine/site-config.mjs";
import { headers, writeSiteRoot } from "../engine/site-root.mjs";
import { buildManifest } from "../manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");

/** A content tree whose note sets text in a face. */
const PATHS = { content: "content" };
/** A content tree whose note sets text only in a generic family. */
const GENERIC = { content: "generic" };

const note = (root: string, dir: string, body: string) => {
    fs.mkdirSync(path.join(root, dir, "Lore"), { recursive: true });
    fs.writeFileSync(
        path.join(root, dir, "Lore", "Note.md"),
        `---\ntype: lore\nshortcode: note\n---\n\n${body}\n`,
    );
};

let withFonts: string;
let without: string;

const install = (root: string) =>
    fs.cpSync(FIXTURE, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });

const tree = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(path.relative(dir, full).split(path.sep).join("/"));
        }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out.sort();
};

beforeAll(() => {
    withFonts = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "font-delivery-")));
    without = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "font-delivery-none-")));
    for (const root of [withFonts, without]) {
        fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
        note(root, "content", "Cut as [\u{F0239}\u{F0230}]{font=semaron-kuriale}.");
        note(root, "generic", "Typed as [ka]{font=mono}, and `[x]{font=qalezu-hand}` is code.");
    }
    install(withFonts);
    // A file the package ships that no target uses.
    fs.writeFileSync(
        path.join(withFonts, "node_modules", "@heroiclands", "fonts", "fonts", "NOTES.txt"),
        "stray",
    );
    fs.writeFileSync(
        path.join(withFonts, "node_modules", "@heroiclands", "fonts", "convert.mjs.bak"),
        "stray",
    );
});

afterAll(() => {
    fs.rmSync(withFonts, { recursive: true, force: true });
    fs.rmSync(without, { recursive: true, force: true });
});

const WOFF2 = [
    "PirzathHand-Regular.woff2",
    "QalezuHand-Regular.woff2",
    "SemaronKuriale-Regular.woff2",
    "TengChou-Regular.woff2",
    "ThuravarkCarved-Regular.woff2",
].map((name) => `fonts/${name}`);
const TTF = WOFF2.map((name) => name.replace(/\.woff2$/, ".ttf"));

describe("what is delivered", () => {
    it("is exactly the stylesheet, the WOFF2 files and the licence for the web", () => {
        const found = scriptFontFiles({ rootDir: withFonts, paths: PATHS }, ["woff2"]);

        expect(found?.files).toEqual(["LICENSE", "fonts.css", ...WOFF2]);
        expect(found?.version).toBe("0.0.0-fixture");
    });

    it("is exactly the stylesheet, the TTF files and the licence for a book", () => {
        const found = scriptFontFiles({ rootDir: withFonts, paths: PATHS }, ["ttf"]);

        expect(found?.files).toEqual(["LICENSE", "fonts.css", ...TTF]);
    });

    it("is nothing when the package is not installed", () => {
        expect(scriptFontFiles({ rootDir: without, paths: PATHS }, ["woff2"])).toBeUndefined();
    });

    it("is nothing when no note sets text in a face", () => {
        expect(scriptFontFiles({ rootDir: withFonts, paths: GENERIC }, ["woff2"])).toBeUndefined();
        expect(scriptFontFiles({ rootDir: withFonts }, ["woff2"])).toBeUndefined();
    });

    it("finds the faces the notes use", () => {
        const installed = resolveScriptFonts(withFonts)!;
        expect([...facesUsed({ rootDir: withFonts, paths: PATHS }, installed)]).toEqual([
            "semaron-kuriale",
        ]);
        expect([...facesUsed({ rootDir: withFonts, paths: GENERIC }, installed)]).toEqual([]);
    });
});

describe("the copy", () => {
    it("writes the delivered files and no others", () => {
        const dest = path.join(withFonts, "out", "web");
        const written = copyScriptFonts({ rootDir: withFonts, paths: PATHS }, dest, ["woff2"]);

        expect(tree(dest)).toEqual(["LICENSE", "fonts.css", ...WOFF2]);
        expect(written).toBe(7);
    });

    it("writes nothing for a package that is absent", () => {
        const dest = path.join(without, "out", "web");

        expect(copyScriptFonts({ rootDir: without, paths: PATHS }, dest, ["woff2"])).toBe(0);
        expect(fs.existsSync(dest)).toBe(false);
    });

    it("leaves the relative addresses in the stylesheet resolving from where it sits", () => {
        const dest = path.join(withFonts, "out", "resolve");
        copyScriptFonts({ rootDir: withFonts, paths: PATHS }, dest, ["woff2"]);
        const css = fs.readFileSync(path.join(dest, "fonts.css"), "utf8");

        for (const [, url] of css.matchAll(/url\("([^"]+)"\)/g)) {
            expect(fs.existsSync(path.join(dest, url))).toBe(true);
        }
    });
});

describe("the staged stylesheet", () => {
    it("names only files the stage holds, for the site and the Foundry stage alike", () => {
        const dest = path.join(withFonts, "out", "staged");
        copyScriptFonts({ rootDir: withFonts, paths: PATHS }, dest, ["woff2"]);
        const css = fs.readFileSync(path.join(dest, "fonts.css"), "utf8");
        const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);

        expect(urls).toEqual([
            "fonts/PirzathHand-Regular.woff2",
            "fonts/SemaronKuriale-Regular.woff2",
            "fonts/TengChou-Regular.woff2",
        ]);
        for (const url of urls) expect(fs.existsSync(path.join(dest, url))).toBe(true);
        expect(css).not.toContain("truetype");
        expect(css).toContain("font-display: swap;");
        expect(css).toContain(".hl-semaron-kuriale {");
    });

    it("keeps the TrueType sources where the target stages them", () => {
        const dest = path.join(withFonts, "out", "both");
        copyScriptFonts({ rootDir: withFonts, paths: PATHS }, dest, ["woff2", "ttf"]);
        const css = fs.readFileSync(path.join(dest, "fonts.css"), "utf8");

        expect(css).toContain('url("fonts/SemaronKuriale-Regular.ttf") format("truetype")');
    });

    it("keeps a local source and drops a face that has nothing staged", () => {
        const css = [
            "@font-face {",
            '    font-family: "A";',
            '    src: local("A"), url(fonts/A.woff2) format("woff2"), url("fonts/A.ttf") format("truetype");',
            "}",
            "@font-face {",
            '    font-family: "B";',
            '    src: url("fonts/B.ttf") format("truetype");',
            "}",
            '.hl-a { font-family: "A"; }',
        ].join("\n");

        expect(stagedStylesheet(css, new Set(["fonts/A.woff2"]))).toBe(
            [
                "@font-face {",
                '    font-family: "A";',
                '    src: local("A"), url(fonts/A.woff2) format("woff2");',
                "}",
                '.hl-a { font-family: "A"; }',
            ].join("\n"),
        );
    });
});

describe("the provenance check", () => {
    it("passes a package that ships its stylesheet, its fonts and its licence", () => {
        expect(checkScriptFonts({ rootDir: withFonts, paths: PATHS })).toEqual([]);
    });

    it("reports a font the manifest names and the package lacks, at the manifest", () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "font-delivery-bad-")));
        try {
            fs.writeFileSync(path.join(root, "package.json"), "{}");
            install(root);
            note(root, "content", "Cut as [\u{F0239}]{font=semaron-kuriale}.");
            const pkg = path.join(root, "node_modules", "@heroiclands", "fonts");
            fs.rmSync(path.join(pkg, "fonts", "QalezuHand-Regular.woff2"));
            fs.rmSync(path.join(pkg, "LICENSE"));

            const findings = checkScriptFonts({ rootDir: root, paths: PATHS });

            expect(findings.map((f: { message: string }) => f.message)).toEqual([
                expect.stringContaining("LICENSE"),
                expect.stringContaining("fonts/QalezuHand-Regular.woff2"),
            ]);
            expect(findings.every((f: { severity: string }) => f.severity === "error")).toBe(true);
            expect(findings[0].file).toBe(path.join(pkg, "fonts.json"));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("has nothing to check without the package", () => {
        expect(checkScriptFonts({ rootDir: without, paths: PATHS })).toEqual([]);
    });
});

describe("the site link", () => {
    const base = (extra: object) => ({
        homepage: "https://www.heroiclands.org/demo/",
        contentPackage: "demo",
        site: { title: "Demo", description: "d", assets: "https://cdn.example/" },
        packageBuild: {},
        ...extra,
    });

    it("names the stylesheet by its versioned address when the fonts are delivered", () => {
        const config = base({ rootDir: withFonts, paths: PATHS });

        expect(siteFontsParam(config)).toBe("fonts/heroiclands/0.0.0-fixture/fonts.css");
        const generated = siteSettings({ config: config as never });
        expect(generated.params.scriptFonts).toBe("fonts/heroiclands/0.0.0-fixture/fonts.css");
    });

    it("is absent when the package is, so the theme links nothing", () => {
        const config = base({ rootDir: without, paths: PATHS });

        expect(siteFontsParam(config)).toBeUndefined();
        const generated = siteSettings({ config: config as never });
        expect("scriptFonts" in generated.params).toBe(false);
    });

    it("is absent when no note sets text in a face", () => {
        const config = base({ rootDir: withFonts, paths: GENERIC });

        const generated = siteSettings({ config: config as never });
        expect("scriptFonts" in generated.params).toBe(false);
    });

    it("is linked by the base layout only behind that setting", () => {
        const template = fs.readFileSync(
            path.join(HERE, "..", "site-theme", "layouts", "base.hbs"),
            "utf8",
        );

        expect(template).toMatch(/\{\{#if site\.urls\.scriptFonts\}\}[\s\S]*?stylesheet/);
        expect(template).not.toMatch(/heroiclands\//);
    });
});

describe("the cache rule", () => {
    it("pins the versioned path for a year, immutable, when the site carries it", async () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "font-headers-"));
        try {
            fs.mkdirSync(path.join(out, "demo", "fonts", "heroiclands", "1.0.0"), {
                recursive: true,
            });
            fs.writeFileSync(path.join(out, "demo", "index.html"), "<html></html>");

            await writeSiteRoot({ pkg: "demo", out, search: false });

            expect(fs.readFileSync(path.join(out, "_headers"), "utf8")).toBe(
                headers({ pkg: "demo", fonts: true }),
            );
            expect(fs.readFileSync(path.join(out, "_headers"), "utf8")).toContain(
                "/demo/fonts/heroiclands/*\n  Cache-Control: public, max-age=31536000, immutable",
            );
        } finally {
            fs.rmSync(out, { recursive: true, force: true });
        }
    });

    it("is not written when the site carries no fonts", async () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "font-headers-none-"));
        try {
            fs.mkdirSync(path.join(out, "demo"), { recursive: true });
            fs.writeFileSync(path.join(out, "demo", "index.html"), "<html></html>");

            await writeSiteRoot({ pkg: "demo", out, search: false });

            expect(fs.readFileSync(path.join(out, "_headers"), "utf8")).toBe(headers());
            expect(headers()).not.toContain("Cache-Control");
        } finally {
            fs.rmSync(out, { recursive: true, force: true });
        }
    });
});

describe("the manifest styles", () => {
    const entry = { src: "fonts/heroiclands/fonts.css", layer: "modules" };

    it("names the fonts after the base sheet and before the package's own", () => {
        const base = withBaseStyle({
            declared: [{ src: "styles/own.css", layer: "own" }],
            artifact: "module",
        });

        expect(withScriptFontStyle({ styles: base, artifact: "module", delivered: true })).toEqual([
            { src: BASE_STYLESHEET_DEST, layer: "modules" },
            entry,
            { src: "styles/own.css", layer: "own" },
        ]);
    });

    it("uses the layer of the package kind", () => {
        expect(withScriptFontStyle({ styles: [], artifact: "system", delivered: true })).toEqual([
            { src: "fonts/heroiclands/fonts.css", layer: "system" },
        ]);
    });

    it("changes nothing when the fonts are not delivered", () => {
        const base = withBaseStyle({ declared: undefined, artifact: "module" });

        expect(withScriptFontStyle({ styles: base, artifact: "module", delivered: false })).toBe(
            base,
        );
        expect(
            withScriptFontStyle({ styles: undefined, artifact: "module", delivered: false }),
        ).toBeUndefined();
    });

    it("does not name it twice", () => {
        const once = withScriptFontStyle({ styles: [], artifact: "module", delivered: true });

        expect(withScriptFontStyle({ styles: once, artifact: "module", delivered: true })).toEqual(
            once,
        );
    });

    const build = (root: string) =>
        buildManifest({
            config: {
                foundryPackage: "demo",
                contentPackage: "demo",
                stats: { systemId: "sohl" },
                compatibility: { minimum: "14.359" },
                relationships: {},
                packs: [{ name: "items", type: "Item", label: "Items", private: false }],
                rootDir: root,
                paths: PATHS,
                packageBuild: { manifest: { title: "Demo" } },
            },
            packageJson: { version: "1.0.0", repository: "https://example.org/demo.git" },
            artifact: "module",
        }) as { styles?: unknown };

    it("is derived into a built manifest when the package is installed", () => {
        expect(build(withFonts).styles).toEqual([
            { src: BASE_STYLESHEET_DEST, layer: "modules" },
            entry,
        ]);
    });

    it("leaves a built manifest at the base sheet when the package is absent", () => {
        expect(build(without).styles).toEqual([{ src: BASE_STYLESHEET_DEST, layer: "modules" }]);
    });
});

describe("the book", () => {
    it("searches the installed package's fonts directory after the shipped one", () => {
        const config = { rootDir: withFonts, paths: PATHS };
        const dir = typstScriptFontPath(config);

        expect(dir).toBe(path.join(withFonts, "node_modules", "@heroiclands", "fonts", "fonts"));
        const args = typstFontArgs({}, config);
        const searched = args[args.indexOf("--font-path") + 1].split(path.delimiter);
        expect(searched[searched.length - 1]).toBe(dir);
    });

    it("keeps a consumer's own directory ahead of the package's", () => {
        const config = { rootDir: withFonts, paths: PATHS };
        const args = typstFontArgs({ fonts: { path: "/pkg/fonts" } }, config);
        const searched = args[args.indexOf("--font-path") + 1].split(path.delimiter);

        expect(searched.slice(1)).toEqual(["/pkg/fonts", typstScriptFontPath(config)]);
    });

    it("adds nothing without the package or without a face in use", () => {
        const plain = typstFontArgs({});

        expect(typstFontArgs({}, { rootDir: without, paths: PATHS })).toEqual(plain);
        expect(typstFontArgs({}, { rootDir: withFonts, paths: GENERIC })).toEqual(plain);
        expect(typstScriptFontPath({ rootDir: without, paths: PATHS })).toBeUndefined();
    });

    it("is passed through the compile invocation", () => {
        const args = typstArgs("b.typ", "b.pdf", {}, { rootDir: withFonts, paths: PATHS });

        expect(args[args.indexOf("--font-path") + 1]).toContain(
            path.join("@heroiclands", "fonts", "fonts"),
        );
        expect(args.slice(-2)).toEqual(["b.typ", "b.pdf"]);
    });
});
