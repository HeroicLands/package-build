/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The base stylesheet is shipped, staged and declared.
 *
 * Three things can each break it silently and none of them is observable from
 * the others: the file can fail to ship in the npm package, the stage can fail
 * to copy it, and the manifest can fail to name it. A package whose manifest
 * names a sheet that was never staged loads nothing and says nothing, which is
 * the failure mode this repository keeps finding in its own satellites — so
 * each link is checked on its own, and the two addressed ends are checked
 * against each other rather than against a second copy of the path.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
    BASE_STYLESHEET_DEST,
    baseStyleEntry,
    baseStyleLayer,
    baseStyleStageEntry,
    baseStylesheetSource,
    withBaseStyle,
} from "../engine/base-styles.mjs";
import { ALERT_TYPES, renderAlerts } from "../engine/content-alerts.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { convertWikilinks } from "../engine/wikilinks.mjs";
import { buildManifest } from "../manifest.mjs";
import { resolvePackageBuildConfig } from "../config.mjs";

const ROOT = path.resolve(__dirname, "..");

describe("the shipped stylesheet", () => {
    it("exists where the stage will look for it", () => {
        expect(() => readFileSync(baseStylesheetSource(), "utf8")).not.toThrow();
    });

    // `files` is what reaches a consumer through npm. The sheet lives under
    // `assets`, which is listed — but a later move out of it would ship a
    // package whose every consumer stages a file that is not there.
    it("sits under a directory package.json ships", () => {
        const { files } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
            files: string[];
        };
        const relative = path.relative(ROOT, baseStylesheetSource());
        expect(files.some((entry) => relative === entry || relative.startsWith(`${entry}/`))).toBe(
            true,
        );
    });

    it("names the containers it is scoped to, and no bare element selector", () => {
        const css = readFileSync(baseStylesheetSource(), "utf8");
        // Foundry styles `dl dt` and `dl dd` application-wide in an earlier
        // cascade layer than a package's styles load into, so an unscoped rule
        // here would restyle Foundry's own interface and every other
        // package's. Every rule outside the container query is anchored to a
        // content root.
        const beforeContainer = css.replace(/\/\*[\s\S]*?\*\//g, "").split("@container")[0];
        const selectors = beforeContainer
            .split("}")
            .map((block) => block.split("{")[0].trim())
            .filter(Boolean);
        expect(selectors.length).toBeGreaterThan(0);
        for (const selector of selectors) {
            expect(selector).toContain(".journal-entry-page");
        }
    });
});

describe("baseStyleLayer", () => {
    // Foundry's own layer order ends `… layouts, system, modules, exceptions`,
    // the eighth and ninth being default system and default module styles. The
    // sheet takes the one its kind is given, which makes it the weakest thing
    // a package can load and so overridable from the package's own sheet.
    it("is the layer Foundry reserves for the package kind", () => {
        expect(baseStyleLayer("system")).toBe("system");
        expect(baseStyleLayer("module")).toBe("modules");
    });
});

describe("baseStyleStageEntry", () => {
    it("copies the installed file to the destination the manifest names", () => {
        const [src, dest] = baseStyleStageEntry("build/stage");

        expect(src).toBe(baseStylesheetSource());
        expect(path.isAbsolute(src)).toBe(true);
        expect(dest).toBe(path.join("build/stage", BASE_STYLESHEET_DEST));
    });

    // The staged path and the declared path are one value, so a rename cannot
    // move one without the other.
    it("stages exactly what the manifest entry addresses", () => {
        const [, dest] = baseStyleStageEntry("build/stage");

        expect(dest.endsWith(baseStyleEntry("module").src)).toBe(true);
    });
});

describe("withBaseStyle", () => {
    it("names the sheet first, ahead of what the package declares", () => {
        const styles = withBaseStyle({
            declared: [{ src: "styles/thalorna.css", layer: "thalorna" }],
            artifact: "module",
        });

        expect(styles).toEqual([
            { src: BASE_STYLESHEET_DEST, layer: "modules" },
            { src: "styles/thalorna.css", layer: "thalorna" },
        ]);
    });

    // Four of the five packages that need the sheet have no stylesheet at all,
    // so the common case is a package declaring nothing.
    it("supplies the whole list for a package that declares none", () => {
        expect(withBaseStyle({ declared: undefined, artifact: "system" })).toEqual([
            { src: BASE_STYLESHEET_DEST, layer: "system" },
        ]);
    });

    it("leaves a declared string list alone but for the addition", () => {
        expect(withBaseStyle({ declared: ["styles/hm3.css"], artifact: "system" })).toEqual([
            { src: BASE_STYLESHEET_DEST, layer: "system" },
            "styles/hm3.css",
        ]);
    });

    // Declaring the staged path is how a package places the sheet somewhere
    // other than first, or loads it into a layer of its own choosing. That is
    // a placement, not a mistake, so it is honoured rather than duplicated.
    it("does not duplicate a sheet the package placed itself", () => {
        const declared = [
            { src: "styles/own.css" },
            { src: BASE_STYLESHEET_DEST, layer: "exceptions" },
        ];

        expect(withBaseStyle({ declared, artifact: "module" })).toEqual(declared);
    });

    it("adds nothing when the package declines it", () => {
        expect(
            withBaseStyle({ declared: undefined, artifact: "module", enabled: false }),
        ).toBeUndefined();
        expect(
            withBaseStyle({ declared: ["styles/own.css"], artifact: "module", enabled: false }),
        ).toEqual(["styles/own.css"]);
    });
});

describe("packageBuild.baseStyles", () => {
    const shared = (packageBuild: Record<string, unknown>) => ({
        rootDir: "/repo",
        packageKind: "modules",
        foundryPackage: "acme",
        packageBuild,
    });

    it("is on for a package that says nothing", () => {
        expect(resolvePackageBuildConfig(shared({}) as never).baseStyles).toBe(true);
    });

    it("is off when declined", () => {
        expect(resolvePackageBuildConfig(shared({ baseStyles: false }) as never).baseStyles).toBe(
            false,
        );
    });

    // `"false"` reads as off and would be on — the one wrong answer available
    // here, so it is refused rather than coerced.
    it("refuses a value that is not a boolean", () => {
        expect(() => resolvePackageBuildConfig(shared({ baseStyles: "false" }) as never)).toThrow(
            /`packageBuild.baseStyles` must be true or false/,
        );
    });
});

describe("the generated manifest", () => {
    /** A resolved configuration, with only what the manifest reads. */
    function config(packageBuild: Record<string, unknown>) {
        return {
            foundryPackage: "thalorna",
            contentPackage: "thalorna",
            stats: { systemId: "sohl" },
            compatibility: { minimum: "14.359" },
            relationships: {},
            packs: [{ name: "items", type: "Item", label: "Items", private: false }],
            packageBuild: { manifest: { title: "Thalorna Setting" }, ...packageBuild },
        };
    }

    const packageJson = {
        version: "1.2.3",
        repository: { url: "https://github.com/HeroicLands/thalorna" },
    };

    const build = (packageBuild: Record<string, unknown> = {}, artifact = "module") =>
        buildManifest({
            config: config(packageBuild) as never,
            packageJson,
            artifact,
        }) as Record<string, unknown>;

    it("declares the sheet for a package that declares no styles of its own", () => {
        expect(build().styles).toEqual([{ src: BASE_STYLESHEET_DEST, layer: "modules" }]);
    });

    it("keeps the package's own sheet, and reads it second", () => {
        const manifest = build({
            manifest: {
                title: "Thalorna Setting",
                styles: [{ src: "styles/thalorna.css", layer: "thalorna" }],
            },
        });

        expect(manifest.styles).toEqual([
            { src: BASE_STYLESHEET_DEST, layer: "modules" },
            { src: "styles/thalorna.css", layer: "thalorna" },
        ]);
    });

    it("takes the system layer for a system package", () => {
        expect(build({}, "system").styles).toEqual([
            { src: BASE_STYLESHEET_DEST, layer: "system" },
        ]);
    });

    it("emits no styles at all for a package that declines the sheet and has none", () => {
        expect(build({ baseStyles: false }).styles).toBeUndefined();
    });

    it("leaves a declining package's own styles untouched", () => {
        const manifest = build({
            baseStyles: false,
            manifest: { title: "Thalorna Setting", styles: ["styles/thalorna.css"] },
        });

        expect(manifest.styles).toEqual(["styles/thalorna.css"]);
    });
});

describe("alert presentation on both surfaces", () => {
    const styles = [baseStylesheetSource(), path.join(ROOT, "hugo-theme/static/css/style.css")];
    for (const file of styles) {
        it(`styles all four alert types with distinct accents in ${path.relative(ROOT, file)}`, () => {
            const css = readFileSync(file, "utf8");
            const colors = Object.keys(ALERT_TYPES).map((type) => {
                const block = new RegExp(`\\.alert-${type}\\s*\\{([^}]+)\\}`).exec(css)?.[1];
                expect(block).toBeTruthy();
                return /--pb-alert-color:\s*(#[a-f0-9]+)/i.exec(block ?? "")?.[1];
            });
            expect(new Set(colors).size).toBe(4);
            expect(colors).not.toContain(undefined);
            expect(css).toMatch(
                /\.alert\s*\{[^}]*border-inline-start:[^}]*var\(--pb-alert-color\)/s,
            );
            expect(css).toMatch(/\.alert-title\s*\{[^}]*color:\s*var\(--pb-alert-color\)/s);
            expect(css).toMatch(/\.alert-icon\s*\{[^}]*fill:\s*currentColor/s);
        });
    }
});

it("custom alert titles retain their type styling and have no expander", () => {
    const result = renderAlerts('> [!WARNING] {title="Shoal ahead"}\n> Sail carefully.');
    expect(result.errors).toEqual([]);
    expect(result.markdown).toContain('class="alert alert-warning"');
    expect(result.markdown).toContain('class="alert-title"');
    expect(result.markdown).toContain("Shoal ahead");
    expect(result.markdown).not.toContain("<details");
    expect(result.markdown).not.toContain("<summary");
});

describe("what the Foundry renderer emits", () => {
    // Every construct an author can write, rendered the way a journal page is.
    // A class it emits is either styled by the shipped sheet or named below with
    // the reason it needs no rule, so a new construct cannot reach Foundry
    // looking different from the preview and the site without a test saying so.
    const constructs = [
        'A man named [Forgath the Old]{.name data-type="being/npc"} and a [hidden thing]{.secret}.[^1]',
        ...Object.keys(ALERT_TYPES).map((type) => `> [!${type.toUpperCase()}]\n> Text.`),
        ':::secret {title="For the GM"}\nGM text.\n:::',
        "Term\n: Its definition.",
        "```verse\n    A line\n      An indented line\n```",
        ":@ A picture\n\n![A](icons/svg/mystery-man.svg)",
        ":@ A table\n\n| A | B |\n| --- | --- |\n| a | b |",
        ":@ A verse\n\n```verse\nA verse\n```",
        "```verse {numstep=1 lang=en col1=en col2=en/x:en}\n[A verse line]{lang=en}\n\n***\n\n[Another]{lang=en}\n```",
        ":@ A passage\n\nA paragraph.",
        "| Left | Right |\n| :--- | ---: |\n| a | b |",
        "[^1]: A footnote.",
    ].join("\n\n");
    const unresolved = convertWikilinks("See [[place-nowhere|Nowhere]].", {
        type: "place",
        id: "x",
        pack: "p",
        docPack: "p",
        index: new Map(),
    }).markdown;
    const html = renderFoundryMarkdown(`${constructs}\n\n${unresolved}`);
    const emitted = new Set(
        [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/)),
    );

    const NO_RULE: Record<string, string> = {
        secret: "Foundry styles section.secret and owns its reveal control",
        footnotes: "an ordinary section and ordered list read correctly unstyled",
        "footnotes-list": "an ordinary ordered list",
        "footnote-item": "an ordinary list item",
        "footnote-ref": "a superscript link, styled as a link",
        "footnote-backref": "an ordinary link",
    };
    // Font Awesome classes are Foundry's own; figure kinds are styled alike
    // through `.content-figure`, so a kind added later needs no rule.
    const isIcon = (name: string) => /^fa(-|$)/.test(name);
    const isFigureKind = (name: string) =>
        /^content-figure-/.test(name) && name !== "content-figure-label";

    it("renders the constructs it is meant to check", () => {
        for (const name of [
            "name",
            "alert",
            "verse",
            "verse-columns",
            "verse-row",
            "verse-secondary",
            "dictionary",
            "content-figure",
        ])
            expect(emitted).toContain(name);
        expect(emitted).toContain("sohl-unresolved-link");
    });

    it("styles every class it emits, or says why none is needed", () => {
        const css = readFileSync(baseStylesheetSource(), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        const styled = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]));
        const missing = [...emitted].filter(
            (name) =>
                !styled.has(name) && !(name in NO_RULE) && !isIcon(name) && !isFigureKind(name),
        );
        expect(missing).toEqual([]);
    });

    it("keeps no exemption for a class that is no longer emitted", () => {
        for (const name of Object.keys(NO_RULE)) expect(emitted).toContain(name);
    });
});
