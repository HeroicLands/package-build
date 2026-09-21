/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A package site is its homepage at `/<package>/` and one page per note at
 * `/<package>/<type>-<shortcode>/`, and nothing between them is generated.
 *
 * Every structure above the pages — which notes belong together, in what
 * order, under which headings — is authored, as a `doc` note carrying a
 * content table. So a configuration that asks the build to write an index of
 * its own is refused, the homepage is the mount's `_index.md`, the deployment
 * root carries no redirect, and the generated Hugo configuration renders the
 * `home` and `page` kinds only.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import { defineConfig } from "../index.mjs";
import type { ContentBuildConfigInput } from "../content-config.mjs";
import { DERIVED_HUGO_KEYS } from "../content-config.mjs";
import {
    HOMEPAGE_DESTINATION,
    HOMEPAGE_REFUSED_FIELDS,
    HOMEPAGE_SHORTCODE,
    HOMEPAGE_TYPE,
    homepageAddresses,
    homepageFrontmatter,
} from "../engine/homepage.mjs";
import * as homepageModule from "../engine/homepage.mjs";
import * as siteBuild from "../engine/site-build.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";
import * as siteRoot from "../engine/site-root.mjs";
import { headers, writeSiteRoot } from "../engine/site-root.mjs";
import { DISABLE_KINDS, hugoConfig, hugoToml } from "../engine/site-config.mjs";
import { buildSiteIndex } from "../engine/site-index.mjs";
import { loadForeignIndexes } from "../engine/metadata-index.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import * as noteVocabulary from "../engine/note-vocabulary.mjs";

/** The one message every generated-index key is refused with. */
const INDEX_IS_A_NOTE = /a site is its homepage and its pages.*is a `doc` note/s;

/** A minimal configuration `defineConfig` accepts without complaint. */
function minimal(overrides: Record<string, unknown> = {}) {
    return {
        rootDir: "/repo",
        contentPackage: "acme",
        foundryPackage: "acme",
        packageKind: "systems",
        stats: { lastModifiedBy: "acmebuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        ...overrides,
    } as ContentBuildConfigInput;
}

/* ---------------------------------------------------------------------- */
/*  1. No configured index between the homepage and the pages              */
/* ---------------------------------------------------------------------- */

describe("a configured index between the homepage and the pages is refused", () => {
    it("refuses `site.sections`, saying an index is a `doc` note", () => {
        expect(() =>
            defineConfig(minimal({ site: { sections: { being: { title: "Beings" } } } })),
        ).toThrow(/`site\.sections`/);
        expect(() =>
            defineConfig(minimal({ site: { sections: { being: { title: "Beings" } } } })),
        ).toThrow(INDEX_IS_A_NOTE);
    });

    it("refuses an empty `site.sections` too — the key has no reader", () => {
        expect(() => defineConfig(minimal({ site: { sections: {} } }))).toThrow(/`site\.sections`/);
    });

    it("refuses `listType` / `listSubType`, which only a section could carry", () => {
        expect(() =>
            defineConfig(
                minimal({
                    site: { sections: { rules: { title: "Rules", listType: "doc" } } },
                }),
            ),
        ).toThrow(INDEX_IS_A_NOTE);
        expect(() =>
            defineConfig(
                minimal({
                    site: {
                        sections: {
                            rules: { title: "Rules", listType: "doc", listSubType: "rules" },
                        },
                    },
                }),
            ),
        ).toThrow(INDEX_IS_A_NOTE);
    });

    it("refuses `site.backfillSections`, whichever way it is set", () => {
        expect(() => defineConfig(minimal({ site: { backfillSections: true } }))).toThrow(
            /`site\.backfillSections`/,
        );
        expect(() => defineConfig(minimal({ site: { backfillSections: false } }))).toThrow(
            INDEX_IS_A_NOTE,
        );
    });

    it("refuses `site.list` — how a listing renders is a content table's to say", () => {
        expect(() => defineConfig(minimal({ site: { list: { shortcodes: true } } }))).toThrow(
            /`site\.list`.*a site is its homepage and its pages/s,
        );
    });

    it("refuses `site.landing` — the mount's own index is the homepage", () => {
        expect(() =>
            defineConfig(
                minimal({ site: { landing: { title: "Knowledgebase", type: "knowledgebase" } } }),
            ),
        ).toThrow(/`site\.landing`.*a site is its homepage and its pages/s);
    });

    it("resolves a `site` block without any of them, and carries none", () => {
        const config = defineConfig(minimal({ site: { description: "A package." } }));
        expect("sections" in config.site).toBe(false);
        expect("landing" in config.site).toBe(false);
        expect("backfillSections" in config.site).toBe(false);
        expect("list" in config.site).toBe(false);
    });

    it("exports no section writer", () => {
        expect("writeSectionLandings" in siteBuild).toBe(false);
        expect("sectionFrontmatter" in siteBuild).toBe(false);
        expect("pluralTitle" in siteBuild).toBe(false);
    });
});

/* ---------------------------------------------------------------------- */
/*  2. The homepage is a page with a body                                   */
/* ---------------------------------------------------------------------- */

describe("a homepage is a page with a body, so `landing:` is refused", () => {
    it("names `landing` among the refused fields", () => {
        expect([...HOMEPAGE_REFUSED_FIELDS.keys()]).toEqual(["id", "landing"]);
    });

    it("refuses a homepage that authors a `landing:` block, at the key", () => {
        const findings = lintNote(
            {
                fm: {
                    type: HOMEPAGE_TYPE,
                    shortcode: HOMEPAGE_SHORTCODE,
                    landing: { cards: { source: "sections" } },
                },
                file: "assets/content/homepage.md",
                raw: [
                    "---",
                    `type: ${HOMEPAGE_TYPE}`,
                    `shortcode: ${HOMEPAGE_SHORTCODE}`,
                    "landing:",
                    "    cards:",
                    "        source: sections",
                    "---",
                    "",
                ].join("\n"),
            } as any,
            { schemas: ENGINE_NOTE_SCHEMAS },
        ) as any[];
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ line: 4, column: 1, severity: "error" });
        expect(findings[0].message).toMatch(/`landing`.*body/s);
    });

    it("reads a homepage's addresses from its body only", () => {
        expect(homepageModule).not.toHaveProperty("HOMEPAGE_ADDRESS_KEYS");
        const found = homepageAddresses(
            "See [the rules](kb/rules/) and [Discord](https://discord.gg/x).\n",
        );
        expect(found.map((a) => [a.field, a.url, a.kind])).toEqual([
            ["body", "kb/rules/", "body"],
            ["body", "https://discord.gg/x", "body"],
        ]);
    });
});

/* ---------------------------------------------------------------------- */
/*  3–4. The homepage is the mount's `_index.md`, addressed at the root     */
/* ---------------------------------------------------------------------- */

describe("the homepage is written as the mount's `_index.md`", () => {
    let root: string;

    const write = (rel: string, text: string) => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };
    const note = (rel: string, fm: string, body = "Prose.\n") =>
        write(path.join("assets/content", rel), `---\n${fm.trim()}\n---\n\n${body}`);

    /** Every emitted file below a directory, POSIX-separated and sorted. */
    const emitted = (dir: string): string[] => {
        const out: string[] = [];
        const walk = (d: string) => {
            if (!fs.existsSync(d)) return;
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, e.name);
                if (e.isDirectory()) walk(full);
                else out.push(path.relative(dir, full).split(path.sep).join("/"));
            }
        };
        walk(dir);
        return out.sort();
    };

    const configFor = (overrides: Record<string, unknown> = {}) =>
        defineConfig({
            rootDir: root,
            contentPackage: "demo",
            foundryPackage: "demo",
            packageKind: "modules",
            stats: { lastModifiedBy: "demobuilder0000" },
            packs: [
                { name: "items", type: "Item" },
                { name: "journals", type: "JournalEntry" },
            ],
            packageBuild: { manifest: { title: "The Demo Module" } },
            publish: { site: "content", address: { prefix: "kb/" } },
            ...overrides,
        } as ContentBuildConfigInput);

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-pages-"));
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sandbox", version: "1.0.0" }),
        );
        fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
        note(
            "homepage.md",
            [
                `type: ${HOMEPAGE_TYPE}`,
                `shortcode: ${HOMEPAGE_SHORTCODE}`,
                "title: The World of Demo",
                "description: A demonstration.",
                "banner: brand/banner.webp",
                "tags:",
                "    - featured",
            ].join("\n"),
            "The module, in the author's own words.\n",
        );
        note(
            "Gear/Dagger.md",
            "type: weapongear\nshortcode: dagger\nname:\n    full: Dagger",
            "A blade.\n",
        );
        note(
            "Rules/Welcome.md",
            "type: doc\nsubType: rules\nshortcode: welcome\nname:\n    full: Welcome",
            "Start at [[homepage-root|the front page]].\n",
        );
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("names `_index.md` as the destination, with no per-note destination", () => {
        expect(HOMEPAGE_DESTINATION).toBe("_index.md");
        expect(homepageModule).not.toHaveProperty("homepageDestination");
    });

    it("writes `_index.md` at the package root and nothing else for it", () => {
        const result = buildSite({ config: configFor() });
        expect(gatesFailed(result.gates)).toBe(false);
        const files = emitted(path.join(root, "build/hugo/content"));
        expect(files).toContain("_index.md");
        expect(files.filter((f) => f.startsWith("homepage"))).toEqual([]);
        // The content mount below it holds pages and nothing that makes a
        // section: the root `_index.md` is the only one in the tree.
        expect(files.filter((f) => path.basename(f) === "_index.md")).toEqual(["_index.md"]);
        expect(files).toContain("kb/weapongear-dagger.md");
        expect(files).toContain("kb/doc-welcome.md");
    });

    it("carries the note's frontmatter, the derived title and package, and no `url`", () => {
        buildSite({ config: configFor() });
        const page = fs.readFileSync(path.join(root, "build/hugo/content/_index.md"), "utf8");
        expect(page).toMatch(/^type: homepage$/m);
        expect(page).toMatch(/^title: The World of Demo$/m);
        expect(page).toMatch(/^description: A demonstration\.$/m);
        expect(page).toMatch(/^banner: brand\/banner\.webp$/m);
        expect(page).toMatch(/^package: demo$/m);
        // Hugo's `home` kind publishes at `baseURL` and nowhere else, so the
        // page states no address of its own.
        expect(page).not.toMatch(/^url:/m);
        expect(page).not.toMatch(/^slug:/m);
        expect(page).toContain("The module, in the author's own words.");
    });

    it("states no address in `homepageFrontmatter` either", () => {
        const data = homepageFrontmatter(
            { type: HOMEPAGE_TYPE, shortcode: HOMEPAGE_SHORTCODE, aliases: ["x"] },
            { contentPackage: "demo", title: "Demo" },
        );
        expect(data).toEqual({
            type: HOMEPAGE_TYPE,
            shortcode: HOMEPAGE_SHORTCODE,
            package: "demo",
            title: "Demo",
        });
    });

    it("resolves `[[homepage-root|…]]` to `/<package>/`", () => {
        const result = buildSite({ config: configFor() });
        expect(result.wikiErrors).toEqual([]);
        const page = fs.readFileSync(
            path.join(root, "build/hugo/content/kb/doc-welcome.md"),
            "utf8",
        );
        expect(page).toContain("[the front page](/demo/)");
        expect(page).not.toContain("homepage-root/");
    });

    it("is the whole of a homepage-only site, at the root", () => {
        const result = buildSite({
            config: configFor({ publish: { site: "homepage", address: { prefix: "kb/" } } }),
        });
        expect(result.stats?.homepages).toBe(1);
        expect(emitted(path.join(root, "build/hugo/content"))).toEqual(["_index.md"]);
    });

    it("reports no `hasTags` — a tag is a field a content table filters on", () => {
        const result = buildSite({ config: configFor() });
        expect(result).not.toHaveProperty("hasTags");
        expect(result.stats).not.toHaveProperty("landings");
        expect("hasAnyTag" in noteVocabulary).toBe(false);
    });
});

describe("a foreign package's homepage resolves to its root", () => {
    it("records the homepage's address as the package base, not a page below it", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-foreign-home-"));
        try {
            const dir = path.join(root, "thalorna@1.0.0");
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, "thalorna-metadata.jsonl"),
                [
                    {
                        package: "thalorna",
                        type: HOMEPAGE_TYPE,
                        shortcode: HOMEPAGE_SHORTCODE,
                        title: "The World of Thalorna",
                        address: {
                            slug: "homepage-root",
                            canonical: "thalorna-none-homepage-root",
                        },
                    },
                    {
                        package: "thalorna",
                        type: "being",
                        shortcode: "aurochs",
                        name: { full: "Aurochs" },
                        address: {
                            slug: "being-aurochs",
                            canonical: "thalorna-sohl-being-aurochs",
                        },
                    },
                ]
                    .map((r) => JSON.stringify(r))
                    .join("\n") + "\n",
            );
            fs.writeFileSync(path.join(dir, ".complete"), "");
            const config = {
                paths: { metadataCache: root },
                relationships: {
                    requires: [
                        {
                            id: "thalorna",
                            manifest:
                                "https://github.com/HeroicLands/thalorna/releases/latest/download/module.json",
                        },
                    ],
                },
            } as never;
            const { index, stale } = loadForeignIndexes(config, ["demo"]);
            expect(stale).toEqual([]);
            expect(index.get("thalorna-none-homepage-root")?.url).toBe("/thalorna/");
            expect(index.get("thalorna-sohl-being-aurochs")?.url).toBe("/thalorna/being-aurochs/");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

/* ---------------------------------------------------------------------- */
/*  5. The deployment root carries no redirect                             */
/* ---------------------------------------------------------------------- */

describe("the deployment root is `_headers` alone", () => {
    it("exports no redirect and no landing path", () => {
        expect("redirects" in siteRoot).toBe(false);
        expect("landingPath" in siteRoot).toBe(false);
    });

    it("writes `_headers` and no `_redirects`, removing a stale one", async () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-root-"));
        try {
            fs.mkdirSync(path.join(out, "kethira"), { recursive: true });
            fs.writeFileSync(path.join(out, "kethira", "index.html"), "<html></html>");
            // Left by an earlier build: a root redirect that would send every
            // reader to a page nothing publishes.
            fs.writeFileSync(path.join(out, "_redirects"), "/kethira/  /kethira/x/  301\n");

            // The root files are the question here, not the index.
            const { files } = await writeSiteRoot({ pkg: "kethira", out, search: false });

            expect(files.map((f) => path.basename(f))).toEqual(["_headers"]);
            expect(fs.existsSync(path.join(out, "_redirects"))).toBe(false);
            expect(fs.readFileSync(path.join(out, "_headers"), "utf8")).toBe(headers());
        } finally {
            fs.rmSync(out, { recursive: true, force: true });
        }
    });

    it("suppresses indexing on every host-assigned address, and pins no lifetime", () => {
        const out = headers();
        expect(out.match(/X-Robots-Tag: noindex/g)).toHaveLength(3);
        expect(out).not.toContain("301");
        expect(out).not.toContain("Cache-Control");
    });
});

/* ---------------------------------------------------------------------- */
/*  6. `home` and `page` are the only kinds                                */
/* ---------------------------------------------------------------------- */

describe("the generated Hugo configuration renders `home` and `page` only", () => {
    const NAVIGATION = [{ name: "Home", url: "https://www.heroiclands.org/" }];

    const generatedFor = (tags: string[] | undefined) =>
        hugoConfig({
            config: defineConfig({
                rootDir: "/repo",
                contentPackage: "demo",
                foundryPackage: "demo",
                packageKind: "modules",
                homepage: "https://www.heroiclands.org/demo/",
                stats: { lastModifiedBy: "demobuilder0000" },
                packs: [{ name: "items", type: "Item" }],
                packageBuild: { manifest: { title: "The Demo Module" } },
                site: { assets: "https://cdn.example.org", description: "A module." },
            } as ContentBuildConfigInput),
            navigation: NAVIGATION,
            themesDir: "../node_modules/@heroiclands",
            // A tagged tree and an untagged one hand the generator the same
            // inputs: what a note carries reaches the configuration not at all.
            ...(tags ? ({ hasTags: true } as object) : {}),
        });

    it("disables section, taxonomy, term and RSS, for a tagged tree and an untagged one alike", () => {
        expect(DISABLE_KINDS).toEqual(["section", "taxonomy", "term", "RSS"]);
        expect(generatedFor(undefined).disableKinds).toEqual([...DISABLE_KINDS]);
        expect(generatedFor(["featured"]).disableKinds).toEqual([...DISABLE_KINDS]);
    });

    it("emits neither `[taxonomies]` nor `[outputs]`", () => {
        for (const out of [generatedFor(undefined), generatedFor(["featured"])]) {
            expect(out).not.toHaveProperty("taxonomies");
            expect(out).not.toHaveProperty("outputs");
            const toml = hugoToml(out);
            expect(toml).not.toContain("[taxonomies]");
            expect(toml).not.toContain("[outputs]");
            expect(parseToml(toml).disableKinds).toEqual([...DISABLE_KINDS]);
        }
    });

    it("keeps the three keys refused under `site.hugo`, naming the toolchain", () => {
        for (const key of ["disableKinds", "taxonomies", "outputs"]) {
            expect(DERIVED_HUGO_KEYS[key]).toMatch(/homepage and its pages/);
            expect(DERIVED_HUGO_KEYS).not.toHaveProperty("params.list");
            expect(() =>
                defineConfig(
                    minimal({
                        site: { hugo: { [key]: [] } },
                    }),
                ),
            ).toThrow(new RegExp(`\`site\\.hugo\\.${key}\` is derived from`));
        }
    });
});

/* ---------------------------------------------------------------------- */
/*  7. One page per note, whatever it compiles into                         */
/* ---------------------------------------------------------------------- */

describe("a system-bearing note is one page under both of its addresses", () => {
    it("resolves `affiliation/x` and `docaffiliation/x` to the same page", () => {
        const { index, contentTypes } = buildSiteIndex([
            {
                kind: "content",
                fm: { type: "affiliation", shortcode: "guild" },
                name: "The Guild",
                slug: "affiliation-guild",
                base: "Guild.md",
                url: "/thalorna/affiliation-guild/",
            },
        ]);
        expect(index.get("affiliation/guild")?.url).toBe("/thalorna/affiliation-guild/");
        expect(index.get("docaffiliation/guild")?.url).toBe("/thalorna/affiliation-guild/");
        expect(index.get("affiliation/guild")).toBe(index.get("docaffiliation/guild"));
        expect(contentTypes.has("docaffiliation")).toBe(true);
    });
});
