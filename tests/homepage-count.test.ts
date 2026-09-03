/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Exactly one `type: homepage` note per package (#52).
 *
 * #51 gave every package an authored page at `/<package>/` and #55 made it the
 * floor rather than an extra, but nothing required a package to have one — so
 * the failure mode of the whole arrangement was a package that builds green and
 * serves nothing at its own address. Two is the same defect wearing a page:
 * every homepage is written to the same `_index.md`, so the one the walk
 * reaches last silently wins and the package's front page is decided by
 * filename order.
 *
 * The rule is asserted at both call sites, because neither command reaches all
 * six packages: `HarnMaster-3-FoundryVTT` runs `content-build site` and no
 * `content-build lint`, and `sohl-thalorna` runs `content-build lint` and its
 * own site builder.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import type { ContentBuildConfigInput } from "../content-config.mjs";
import { checkHomepageCount, HOMEPAGE_TYPE } from "../engine/homepage.mjs";
import { lintContentTree } from "../engine/content-lint.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";
import { formatDiagnostic } from "../engine/diagnostics.mjs";

/** A throwaway tree, described as `{ relPath: contents }`. */
function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-home-count-"));
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(root, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf8");
    }
    return root;
}

/** A keyed content note, so a tree is populated without being a homepage. */
function note(shortcode = "dagger"): string {
    return [
        "---",
        "type: weapongear",
        `shortcode: ${shortcode}`,
        "name:",
        `    full: ${shortcode}`,
        "---",
        "",
        "Prose.",
        "",
    ].join("\n");
}

/**
 * A homepage note. The `type:` key is deliberately not on the first line, so a
 * finding that reports a real position is distinguishable from one that
 * defaults to `1:1`.
 */
function homepage(title = "The Demo Module", shortcode = "root"): string {
    return [
        "---",
        `title: ${title}`,
        `type: ${HOMEPAGE_TYPE}`,
        `shortcode: ${shortcode}`,
        "---",
        "",
        "The module, in the author's own words.",
        "",
    ].join("\n");
}

describe("checkHomepageCount — the rule itself (#52)", () => {
    it("passes exactly one", () => {
        expect(
            checkHomepageCount([{ file: "assets/content/homepage.md" }], {
                contentBase: "assets/content",
                contentPackage: "sohl",
            }),
        ).toEqual([]);
    });

    it("errors on none, located at the tree that omits it", () => {
        const findings = checkHomepageCount([], {
            contentBase: "assets/content",
            contentPackage: "sohl",
        });
        expect(findings).toHaveLength(1);
        const [f] = findings;
        // There is no file to name, so the locator is the directory the note is
        // missing from — a real path, and the one the author has to add it to.
        // No line and no column are invented for it.
        expect(f.file).toBe("assets/content");
        expect(f.line).toBeUndefined();
        expect(f.column).toBeUndefined();
        expect(f.severity).toBe("error");
        expect(f.message).toContain("`type: homepage`");
        expect(f.message).toContain('package "sohl"');
        expect(f.message).toContain("/sohl/");
    });

    it("drops the package from the message rather than guessing it", () => {
        const [f] = checkHomepageCount([], { contentBase: "assets/content" });
        expect(f.message).not.toContain('package ""');
        expect(f.message).not.toContain("//");
        expect(f.message).toContain("`type: homepage`");
    });

    it("errors once per note on two, each naming the others", () => {
        const root = tree({
            "homepage.md": homepage(),
            "Landing.md": homepage("Second"),
        });
        const first = path.join(root, "homepage.md");
        const second = path.join(root, "Landing.md");

        const findings = checkHomepageCount([{ file: first }, { file: second }], {
            contentBase: root,
            contentPackage: "sohl",
        });
        expect(findings).toHaveLength(2);
        expect(findings.every((f) => f.severity === "error")).toBe(true);
        expect(findings.map((f) => f.file)).toEqual([first, second]);
        // Located at the `homepage` value itself — line 3 of the file, since
        // line 1 is the opening fence and line 2 is `title:`; column 7, past
        // `type: `. The value rather than the key, because the value is what
        // one of the two notes has to stop saying.
        expect(findings[0].line).toBe(3);
        expect(findings[0].column).toBe(7);
        // Each finding names the other path, so two findings name both files.
        expect(findings[0].message).toContain("Landing.md");
        expect(findings[1].message).toContain("homepage.md");
    });

    // The rule used to rest on the fixed destination every homepage shared:
    // the second silently overwrote the first. A homepage is written at its own
    // address now (#182), so two of them publish two pages — and the rule is a
    // cardinality rule, stated as one, rather than a consequence of a
    // collision that no longer happens.
    it("does not justify itself by a shared destination any more", () => {
        const root = tree({
            "homepage.md": homepage(),
            "Landing.md": homepage("Second", "front"),
        });
        const findings = checkHomepageCount(
            [{ file: path.join(root, "homepage.md") }, { file: path.join(root, "Landing.md") }],
            { contentBase: root, contentPackage: "sohl" },
        );
        expect(findings).toHaveLength(2);
        expect(findings[0].message).not.toContain("_index.md");
        expect(findings[0].message).not.toContain("overwrite");
        // Two homepages are two front pages even when their addresses differ,
        // which is exactly what the address rule cannot say.
        expect(findings[0].message).toContain("one front page");
    });

    it("emits in the parseable form, path first", () => {
        const [f] = checkHomepageCount([], {
            contentBase: "assets/content",
            contentPackage: "sohl",
        });
        expect(formatDiagnostic(f)).toMatch(/^assets\/content: error: holds no /);
    });
});

describe("`content-build lint` enforces it (#52)", () => {
    const lint = (files: Record<string, string>) =>
        lintContentTree(tree(files), {
            skipDirectories: [],
            contentPackage: "sohl",
        });

    it("passes a tree with exactly one", () => {
        const r = lint({ "homepage.md": homepage(), "Gear.md": note() });
        expect(r.findings).toEqual([]);
    });

    it("fails a populated tree that declares none", () => {
        const r = lint({ "Gear.md": note() });
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].severity).toBe("error");
        expect(r.findings[0].message).toContain("`type: homepage`");
    });

    it("fails a tree that declares two, naming both", () => {
        const r = lint({
            "homepage.md": homepage(),
            "Landing.md": homepage("Second"),
            "Gear.md": note(),
        });
        const home = r.findings.filter((f) => f.message.includes("`type: homepage`"));
        expect(home).toHaveLength(2);
        expect(home.map((f) => path.basename(f.file)).sort()).toEqual([
            "Landing.md",
            "homepage.md",
        ]);
    });

    it("does not pile a missing homepage onto an absent tree", () => {
        // An empty walk already reports "check that the content tree is
        // present"; adding "and it has no homepage" to that is noise about a
        // tree nobody has yet established exists.
        const r = lint({});
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].message).toContain("holds no content notes");
    });

    it("is not conditional on a shortcode, so a homepage-only tree passes", () => {
        // The one note in the tree is keyless by design (#77).
        const r = lint({ "homepage.md": homepage() });
        expect(r.findings).toEqual([]);
    });
});

describe("the site build enforces it, in both publishing modes (#52)", () => {
    function sandbox(files: Record<string, string>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-home-site-"));
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sandbox", version: "1.0.0" }),
        );
        fs.mkdirSync(path.join(root, "assets/manifests"), { recursive: true });
        for (const [rel, body] of Object.entries(files)) {
            const abs = path.join(root, "assets/content", ...rel.split("/"));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, body, "utf8");
        }
        return root;
    }

    function configFor(root: string, site: "homepage" | "content") {
        return defineConfig({
            rootDir: root,
            contentPackage: "demo",
            foundryPackage: "demo",
            packageKind: "modules",
            stats: {
                lastModifiedBy: "demobuilder0000",
            },
            packs: [{ name: "items", type: "Item" }],
            packageBuild: { manifest: { title: "The Demo Module" } },
            site: { out: "out" },
            publish: {
                site,
                manifests: { publish: true, consume: true },
                address: { prefix: "kb/" },
            },
        } as ContentBuildConfigInput);
    }

    for (const mode of ["homepage", "content"] as const) {
        it(`fails a tree with no homepage in ${mode} mode`, () => {
            // The requirement does not vary by mode: `publish.site` chooses
            // whether the *content* surfaces are published, never whether the
            // package has a front page.
            const root = sandbox({ "Gear/Dagger.md": note() });
            const result = buildSite({ config: configFor(root, mode) });
            expect(gatesFailed(result.gates)).toBe(true);
            expect(result.gates.homepages).toHaveLength(1);
            expect(result.stats).toBeNull();
        });

        it(`fails a tree with two homepages in ${mode} mode`, () => {
            const root = sandbox({
                "homepage.md": homepage(),
                "Landing.md": homepage("Second"),
                "Gear/Dagger.md": note(),
            });
            const result = buildSite({ config: configFor(root, mode) });
            expect(gatesFailed(result.gates)).toBe(true);
            expect(result.gates.homepages).toHaveLength(2);
        });
    }

    it("still builds a tree with exactly one", () => {
        const root = sandbox({
            "homepage.md": homepage(),
            "Gear/Dagger.md": note(),
        });
        const result = buildSite({ config: configFor(root, "content") });
        expect(result.gates.homepages).toEqual([]);
        expect(gatesFailed(result.gates)).toBe(false);
        // Written at its address, not at a destination of its own (#182).
        expect(fs.existsSync(path.join(root, "out/homepage-root.md"))).toBe(true);
    });

    it("fails a homepage that declares no shortcode, before the wipe", () => {
        // The address rule reaches homepage-only mode too, which runs no other
        // gate at all — so it is reported here, beside the count (#182).
        const root = sandbox({
            "homepage.md": ["---", `type: ${HOMEPAGE_TYPE}`, "---", "", "Prose.", ""].join("\n"),
            "Gear/Dagger.md": note(),
        });
        const stale = path.join(root, "out/keep.md");
        fs.mkdirSync(path.dirname(stale), { recursive: true });
        fs.writeFileSync(stale, "the previous build\n");

        const result = buildSite({ config: configFor(root, "content") });
        expect(gatesFailed(result.gates)).toBe(true);
        expect(result.gates.homepages).toHaveLength(1);
        expect(result.gates.homepages[0].message).toContain("shortcode");
        expect(result.stats).toBeNull();
        expect(fs.existsSync(stale)).toBe(true);
    });

    it("fails before it wipes the previous output", () => {
        // `buildSite` clears the whole output tree on every run, so a gate that
        // fired after that would destroy a good site to report a bad tree.
        const root = sandbox({ "Gear/Dagger.md": note() });
        const stale = path.join(root, "out/_index.md");
        fs.mkdirSync(path.dirname(stale), { recursive: true });
        fs.writeFileSync(stale, "the previous build\n");

        const result = buildSite({ config: configFor(root, "homepage") });
        expect(gatesFailed(result.gates)).toBe(true);
        expect(fs.readFileSync(stale, "utf8")).toBe("the previous build\n");
    });
});
