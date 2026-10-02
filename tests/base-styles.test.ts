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
