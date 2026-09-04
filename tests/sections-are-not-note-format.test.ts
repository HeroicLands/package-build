/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A section is a Hugo directory concept, and the note format does not carry one
 * (#204).
 *
 * Since #181 a page's URL **is** its address, `/<package>/<type>-<shortcode>/`,
 * so a section appears in no address at all. Its only remaining job was to pick
 * the directory a page was written into, and the only reason that mattered was
 * Hugo's rule about what counts as a section. So the note format carried a
 * filename convention (`README.md`), a landing rule, a routing function and a
 * refusal — all of them to satisfy a rendering engine's directory semantics.
 *
 * What this file pins is the whole of what changed, and the one thing that did
 * not:
 *
 * - **Pages emit flat**, into the mount itself.
 * - **A `README.md` is an ordinary note**, addressed like every other.
 * - **A `doc` with no `subType` publishes**, because there is no directory left
 *   to have nowhere to file it into.
 * - **A `doc`'s `subType` is a genre again**, closed to the values the type
 *   declares — the vocabulary #197 had to widen for a landing address.
 * - **Every page's `url:` is unchanged**, because a URL comes from the address
 *   and never from the directory. That invariant is the whole claim, so it is
 *   asserted against the emitted tree rather than reasoned about.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";

import { defineConfig } from "../index.mjs";
import * as contentAddressModule from "../engine/content-address.mjs";
import { packageAddress } from "../engine/content-address.mjs";
import { buildSite, collectContentPages, pageDestination } from "../engine/site-build.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

let root: string;

function write(rel: string, text: string) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}

function note(rel: string, frontmatter: string, body = "Prose.\n") {
    return write(path.join("assets/content", rel), `---\n${frontmatter.trim()}\n---\n\n${body}`);
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-204-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );
    fs.mkdirSync(path.join(root, "assets/manifests"), { recursive: true });

    note("homepage.md", "type: homepage\nshortcode: root", "The package, in its own words.\n");
    note(
        "Gear/Dagger.md",
        `type: weapongear
shortcode: dagger
name:
    full: Dagger`,
    );
    note(
        "Rules/Combat.md",
        `type: doc
subType: rules
shortcode: combat
name:
    full: Combat`,
    );
    // The page that introduces a type: an ordinary note named by convention,
    // `doc-<type>`, with no build path of its own.
    note(
        "Gear/Weapons.md",
        `type: doc
subType: reference
shortcode: weapongear
name:
    full: Weapons`,
    );
    // A note that still happens to be called README.md. The filename decides
    // nothing any more.
    note(
        "Rules/README.md",
        `type: doc
subType: rules
shortcode: rulesintro
name:
    full: The Rules`,
    );
    // A `doc` with no subtype. It used to have "no section, so nowhere to file
    // the page"; it is now an ordinary page.
    note(
        "Odds/Homeless.md",
        `type: doc
shortcode: homeless
name:
    full: Homeless`,
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ctx = {
    packages: new Set(["demo"]),
    contentPackage: "demo",
    skipDirectories: [],
    base: "/demo/",
    mount: "/demo/kb/",
    scheme: { prefix: "kb/", landing: "readme" },
};

function configFor(site: Record<string, unknown> = {}) {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [
            { name: "items", type: "Item" },
            { name: "journals", type: "JournalEntry" },
        ],
        publish: {
            site: "content",
            manifests: { publish: true, consume: true },
            address: { prefix: "kb/" },
        },
        site: { out: "out", ...site },
    });
}

describe("a page emits flat, into the mount itself", () => {
    it("writes a content page at its address, with no section directory", () => {
        const page = {
            kind: "content",
            fm: { type: "weapongear" },
            slug: "weapongear-dagger",
            url: "/demo/weapongear-dagger/",
        };
        expect(pageDestination(page as never)).toBe("weapongear-dagger.md");
        expect(path.dirname(pageDestination(page as never))).toBe(".");
    });

    it("still preserves an extra tree's source layout below its section", () => {
        // A `trees` entry is a book with chapters, addressed by its path — the
        // one place a directory is still an address, and untouched here.
        const page = { kind: "tree", sec: "dev-docs", rel: "how-to/testing.md" };
        expect(pageDestination(page as never)).toBe(path.join("dev-docs", "how-to", "testing.md"));
        const landing = { kind: "tree", sec: "dev-docs", rel: "README.md", isReadme: true };
        expect(pageDestination(landing as never)).toBe(path.join("dev-docs", "_index.md"));
    });
});

describe("a `README.md` is an ordinary note", () => {
    it("addresses it by `(type, shortcode)` like every other page", () => {
        const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
        const readme = pages.find((p) => p.base === "README.md")!;
        expect(readme.url).toBe("/demo/doc-rulesintro/");
        expect(pageDestination(readme)).toBe("doc-rulesintro.md");
    });

    it("takes no `isReadme` in the address function at all", () => {
        // The address is a pure function of the frontmatter now: nothing about
        // the file it was read from reaches it.
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        expect(packageAddress(fm, { scheme: { prefix: "kb/", landing: "readme" } })).toBe(
            "doc-rulesintro/",
        );
        expect(packageAddress(fm, { isReadme: true } as never)).toBe("doc-rulesintro/");
    });

    it("exports no `sectionOf`, because nothing routes by a section", () => {
        expect("sectionOf" in contentAddressModule).toBe(false);
    });
});

describe("the 'no section, so nowhere to file the page' refusal is gone", () => {
    it("addresses a `doc` that declares no subtype", () => {
        expect(packageAddress({ type: "doc", shortcode: "homeless" }, {})).toBe("doc-homeless/");
    });

    it("collects it as an ordinary page rather than an address finding", () => {
        const got = collectContentPages(path.join(root, "assets/content"), ctx);
        expect(got.addressFindings).toEqual([]);
        expect(got.pages.map((p) => p.url)).toContain("/demo/doc-homeless/");
    });

    it("still refuses a note with no shortcode — that has no address", () => {
        expect(() => packageAddress({ type: "doc" }, {})).toThrow(/no shortcode/);
    });
});

describe("a `doc`'s `subType` is a genre again", () => {
    const opts = { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY } as never;

    /** A note as the link index hands one over, with a locatable fence. */
    const asNote = (file: string, fm: Record<string, unknown>) => ({
        file,
        type: String(fm.type ?? ""),
        raw: `---\n${Object.entries(fm)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join("\n")}\n---\n`,
        fm,
    });

    it("accepts the genres the type declares", () => {
        for (const subType of ["rules", "userguide", "reference"]) {
            const findings = lintNote(
                asNote("/tree/Rules/Combat.md", { type: "doc", subType, shortcode: "combat" }),
                opts,
            );
            expect(findings, subType).toEqual([]);
        }
    });

    it("refuses a content type as a `doc` subtype, even in a README", () => {
        // #197 widened this check so a `README` landing could name the section
        // it addressed. With no landings there is no address in this field, so
        // the closed genre list answers for every note — README or not.
        for (const file of ["/tree/Weapons/README.md", "/tree/Weapons/Weapons.md"]) {
            const findings = lintNote(
                asNote(file, { type: "doc", subType: "weapongear", shortcode: "weapons" }),
                opts,
            );
            expect(findings, file).toHaveLength(1);
            expect(findings[0].message).toContain("is not one of the subtypes doc declares");
            expect(findings[0].message).toContain("rules, userguide, reference");
            // No configuration is named, because none is consulted.
            expect(findings[0].message).not.toContain("site.sections");
        }
    });

    it("locates the finding, so the diagnostic stays compiler-parseable", () => {
        const findings = lintNote(
            asNote("/tree/Weapons/README.md", {
                type: "doc",
                subType: "weapongear",
                shortcode: "weapons",
            }),
            opts,
        );
        expect(findings[0]).toMatchObject({
            file: "/tree/Weapons/README.md",
            line: 3,
            column: 1,
            severity: "error",
        });
    });

    it("leaves the charset check ahead of it (#206)", () => {
        // The two changes are complementary and land in one function: #206 put
        // a charset error ahead of the closed-set check, and #204 removed the
        // section branch from underneath it. Both survive, in that order. #206
        // also put a retired-spelling warning ahead of the charset check, for
        // `user-guide`; the consumer trees have swept and #210 removed it, so
        // the old spelling is refused by the charset check like any other
        // hyphenated value.
        const retired = lintNote(
            asNote("/tree/Guide/Actions.md", {
                type: "doc",
                subType: "user-guide",
                shortcode: "actions",
            }),
            opts,
        );
        expect(retired).toHaveLength(1);
        expect(retired[0].severity).toBe("error");
        expect(retired[0].message).toMatch(/letters and digits/i);
        expect(retired[0].message).not.toContain("userguide");

        const hyphenated = lintNote(
            asNote("/tree/Guide/Odd.md", {
                type: "doc",
                subType: "user-manual",
                shortcode: "odd",
            }),
            opts,
        );
        expect(hyphenated).toHaveLength(1);
        expect(hyphenated[0].severity).toBe("error");
        expect(hyphenated[0].message).toContain("address segment");
    });

    it("takes no `landing`, `types` or `sections` to decide it", () => {
        // The three options existed only to check a landing's address. Passing
        // them is inert rather than influential — the genre list is the answer.
        const findings = lintNote(
            asNote("/tree/Weapons/README.md", {
                type: "doc",
                subType: "weapongear",
                shortcode: "weapons",
            }),
            {
                ...(opts as object),
                landing: "readme",
                types: ["weapongear"],
                sections: ["weapongear"],
            } as never,
        );
        expect(findings).toHaveLength(1);
    });
});

describe("every page's `url:` survives the move, byte for byte", () => {
    it("publishes each page at `<base><type>-<shortcode>/`, wherever the file lands", () => {
        // The core claim of #204: the emitted *paths* move, and no emitted
        // address does. Read back off the tree the build actually wrote.
        const out = path.join(root, "out");
        const result = buildSite({ config: configFor() });
        expect(result.gates.addressErrors).toEqual([]);
        expect(result.wikiErrors).toEqual([]);

        const mount = path.join(out, "kb");
        const files = fs
            .readdirSync(mount, { withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => e.name)
            .sort();
        // Flat: every content page is a file directly under the mount, named
        // by its address.
        expect(files).toEqual([
            "doc-combat.md",
            "doc-homeless.md",
            "doc-rulesintro.md",
            "doc-weapongear.md",
            "weapongear-dagger.md",
        ]);

        for (const name of files) {
            const { data } = matter(fs.readFileSync(path.join(mount, name), "utf8"));
            expect(data.url, name).toBe(`/demo/${name.replace(/\.md$/, "")}/`);
        }
    });

    it("still writes the mount's own landing and each declared section's", () => {
        // Flat pages are why these matter *more*, not less: with no page filed
        // into `<section>/`, the only thing that makes `/demo/kb/` and
        // `/demo/kb/being/` exist at all is this synthesis.
        buildSite({
            config: configFor({
                landing: { title: "Knowledgebase", type: "knowledgebase" },
                sections: { being: { title: "Beings" } },
            }),
        });
        const mount = path.join(root, "out", "kb");
        expect(fs.readFileSync(path.join(mount, "_index.md"), "utf8")).toContain(
            "type: knowledgebase",
        );
        expect(fs.readFileSync(path.join(mount, "being", "_index.md"), "utf8")).toContain(
            "title: Beings",
        );
    });
});
