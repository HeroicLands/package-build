/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The keys a root site states: where it is served (`site.base`), its authored
 * section pages (`site.sections`), the section its posts are published in
 * with an Atom feed (`site.feed`), its tag pages (`site.tags`), the package
 * sites its sitemap index names (`site.sitemaps`) and the package sites its
 * search reads beside its own (`site.mergeIndexes`).
 *
 * Every malformed value is refused at load, located at the line and column of
 * the key it is written under — or of the list entry, for a list — and a key
 * that cannot mean anything in the site it is written for is refused rather
 * than ignored.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { checkHomepage } from "../config.mjs";
import { configFromData } from "../engine/pack-config.mjs";

/** A documentation package whose `site` block is `site`, as YAML lines. */
const configText = (site: string[]) =>
    [
        "contentPackage: rootdemo",
        "packageKind: documentation",
        "site:",
        "    assets: https://cdn.example.org",
        ...site.map((line) => `    ${line}`),
        "",
    ].join("\n");

/** Resolve a configuration through the loader's own path, from a file on disk. */
function resolve(text: string) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "root-site-config-")));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "rootdemo" }));
    const file = path.join(root, "package-build.config.yaml");
    fs.writeFileSync(file, text);
    return { file, run: () => configFromData(YAML.parse(text), file) };
}

/** The diagnostic a configuration is refused with, and the text at its position. */
function refusal(site: string[]) {
    const text = configText(site);
    const { file, run } = resolve(text);
    let error: Error | undefined;
    try {
        run();
    } catch (err) {
        error = err as Error;
    }
    if (!error) throw new Error("expected the configuration to be refused");
    const located = new RegExp(
        `^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):(\\d+): error: `,
    ).exec(error.message);
    if (!located) throw new Error(`not located: ${error.message}`);
    const [line, column] = [Number(located[1]), Number(located[2])];
    return {
        message: error.message.slice(located[0].length),
        at: text.split("\n")[line - 1].slice(column - 1),
    };
}

const ROOT = ["base: /"];

describe("a root site resolves", () => {
    it("with every key it states, normalised", () => {
        const { run } = resolve(
            configText([
                "base: /",
                "sections:",
                "    blog: doc-blog",
                "    projects: doc-projects",
                "feed: blog",
                "tags: true",
                "sitemaps: [sohl, thalorna]",
                "mergeIndexes: [sohl]",
            ]),
        );
        const { site } = run();
        expect(site.base).toBe("/");
        expect(site.sections).toEqual({ blog: "doc-blog", projects: "doc-projects" });
        expect(site.feed).toBe("blog");
        expect(site.tags).toBe(true);
        expect(site.sitemaps).toEqual(["sohl", "thalorna"]);
        expect(site.mergeIndexes).toEqual(["sohl"]);
    });

    it("with none of them, as a package site", () => {
        const { site } = resolve(configText([])).run();
        expect(site).toMatchObject({
            base: "",
            sections: {},
            feed: "",
            tags: false,
            sitemaps: [],
            mergeIndexes: [],
        });
    });

    it("lists the new keys among those `site` recognises", () => {
        const { message } = refusal(["sitemap: [sohl]"]);
        expect(message).toContain(
            "expected one of: base, title, assets, description, packages, pass, passOptions, " +
                "notfound, search, maps, sections, feed, tags, sitemaps, mergeIndexes",
        );
    });
});

describe("`site.base`", () => {
    it.each(["blog/", "/blog", "https://www.example.org/"])("refuses %s", (base) => {
        const { message, at } = refusal([`base: ${base}`]);
        expect(message).toContain("`site.base`");
        expect(message).toContain("begins and ends with `/`");
        expect(at).toBe(`base: ${base}`);
    });
});

describe("`site.sections`", () => {
    it("refuses a value that is not a mapping", () => {
        const { message, at } = refusal(["sections: [blog]"]);
        expect(message).toContain("`site.sections` must be a mapping");
        expect(at).toBe("sections: [blog]");
    });

    it("refuses a section name that is not one address segment", () => {
        const { message, at } = refusal(["sections:", "    the-blog: doc-blog"]);
        expect(message).toContain("`site.sections.the-blog`");
        expect(message).toContain("lowercase letters and digits");
        expect(at).toMatch(/^the-blog/);
    });

    it("refuses a page that is not a note's address", () => {
        const { message, at } = refusal(["sections:", "    blog: Blog"]);
        expect(message).toContain("`site.sections.blog`");
        expect(message).toContain("`<type>-<shortcode>`");
        expect(at).toBe("blog: Blog");
    });

    it("refuses the homepage as a section's page", () => {
        const { message, at } = refusal(["sections:", "    blog: homepage-root"]);
        expect(message).toContain("the homepage is the site's front page");
        expect(at).toBe("blog: homepage-root");
    });

    it("refuses one note as the page of two sections", () => {
        const { message, at } = refusal(["sections:", "    blog: doc-blog", "    news: doc-blog"]);
        expect(message).toContain("`site.sections.news`");
        expect(message).toContain("already the page of `blog`");
        expect(at).toBe("news: doc-blog");
    });

    it.each(["tags", "css", "js", "fonts", "img", "pagefind"])(
        "refuses %s, which the site writes itself",
        (name) => {
            const { message, at } = refusal(["sections:", `    ${name}: doc-x`]);
            expect(message).toContain(`\`site.sections.${name}\``);
            expect(message).toContain("the site writes");
            expect(at).toMatch(new RegExp(`^${name}`));
        },
    );
});

describe("`site.feed`", () => {
    it("refuses a value that is not one address segment", () => {
        const { message, at } = refusal(["feed: blog/atom.xml"]);
        expect(message).toContain("`site.feed`");
        expect(message).toContain("lowercase letters and digits");
        expect(at).toBe("feed: blog/atom.xml");
    });

    it("refuses a section the site writes itself", () => {
        const { message, at } = refusal(["feed: tags"]);
        expect(message).toContain("the site writes");
        expect(at).toBe("feed: tags");
    });
});

describe("`site.tags`", () => {
    it("must be a boolean", () => {
        const { message, at } = refusal(["tags: [news]"]);
        expect(message).toContain("`site.tags` must be a boolean");
        expect(at).toBe("tags: [news]");
    });
});

describe.each(["sitemaps", "mergeIndexes"])("`site.%s`", (key) => {
    it("must be a list", () => {
        const { message, at } = refusal([...ROOT, `${key}: sohl`]);
        expect(message).toContain(`\`site.${key}\` must be a list`);
        expect(at).toBe(`${key}: sohl`);
    });

    it("refuses an entry that is not a package name, at the entry", () => {
        const { message, at } = refusal([...ROOT, `${key}: [sohl, harn-adventures]`]);
        expect(message).toContain(`\`site.${key}[1]\``);
        expect(message).toContain("contentPackage");
        expect(at).toMatch(/^harn-adventures/);
    });

    it("refuses a package named twice", () => {
        const { message, at } = refusal([...ROOT, `${key}: [sohl, thalorna, sohl]`]);
        expect(message).toContain(`\`site.${key}[2]\``);
        expect(message).toContain("more than once");
        expect(at).toMatch(/^sohl\]/);
    });

    it("refuses the site's own package", () => {
        const { message, at } = refusal([...ROOT, `${key}: [rootdemo]`]);
        expect(message).toContain("this site's own");
        expect(at).toMatch(/^rootdemo/);
    });
});

describe("a key that means nothing in the site it is written for", () => {
    it("refuses `site.sitemaps` on a site not served at its origin's root", () => {
        const { message, at } = refusal(["sitemaps: [sohl]"]);
        expect(message).toContain("`site.sitemaps`");
        expect(message).toContain("root of an origin");
        expect(message).toContain("`/rootdemo/`");
        expect(at).toBe("sitemaps: [sohl]");
    });

    it("refuses `site.mergeIndexes` on a site with no search", () => {
        const { message, at } = refusal([...ROOT, "search: false", "mergeIndexes: [sohl]"]);
        expect(message).toContain("`site.mergeIndexes`");
        expect(message).toContain("`site.search` is `false`");
        expect(at).toBe("mergeIndexes: [sohl]");
    });
});

describe("`package.json`'s `homepage`", () => {
    it("is the origin's root for a site served there", () => {
        expect(() => checkHomepage("https://www.example.org/", "rootdemo", "/")).not.toThrow();
    });

    it("must end in the base a site is served at", () => {
        expect(() => checkHomepage("https://www.example.org/rootdemo/", "rootdemo", "/")).toThrow(
            "must be the root of its origin",
        );
    });

    it("ends in `/<contentPackage>/` for a package site", () => {
        expect(() => checkHomepage("https://www.example.org/rootdemo/", "rootdemo")).not.toThrow();
        expect(() => checkHomepage("https://www.example.org/", "rootdemo")).toThrow(
            "must end `/rootdemo/`",
        );
    });
});
