/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A note's package is the repository's configured `contentPackage` (#56).
 *
 * `package:` used to be a **selector**: a note compiled when its frontmatter
 * matched the configured package, and was skipped — as `skippedOther`,
 * indistinguishable from the thousands of notes that legitimately belong to
 * another pass — when it did not. Every content tree is single-package, so the
 * field restated a constant ~6,200 times, and a value that matched nothing
 * filtered the whole tree out while the build exited 0.
 *
 * Three steps retire it. The first (3.3.0) made it **optional**: an absent
 * field was normal, an agreeing one was accepted, a disagreeing one was an
 * error. The second swept it out of all four content trees on the org. This
 * suite pins the third: the field is **rejected outright**, whatever it says,
 * and nothing anywhere reads it again.
 *
 * The one thing that must keep working is a generated table's `WHERE … and
 * package = "x"` clause. That value is **synthesised** for the search, never
 * authored — 34 such clauses in `thalorna` and 11 in `sohl` depend on it — so
 * it has its own cases below.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    assertNoDeclaredPackage,
    searchableFrontmatter,
} from "../engine/note-package.mjs";
import * as notePackageModule from "../engine/note-package.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import {
    collectManifestEntries,
    manifestContext,
} from "../engine/manifest-emit.mjs";
import { defineConfig } from "../index.mjs";

/** The package this suite's fixture repository compiles. */
const OWN = contentPackage();

describe("nothing derives a package from a note any more", () => {
    it("exports no `notePackage`, so a stale reader fails at import", () => {
        // The seam existed to answer "declared or configured?" for a reader
        // that might meet either. There is no declared value now, so a call
        // site takes `contentPackage` directly and this export is gone — an
        // import of it is a load-time error rather than a silent read of a
        // field nothing writes (#56).
        expect("notePackage" in notePackageModule).toBe(false);
    });
});

describe("assertNoDeclaredPackage — the field is rejected outright", () => {
    it("accepts a note that declares nothing", () => {
        expect(() => assertNoDeclaredPackage({ type: "doc" })).not.toThrow();
    });

    it("rejects a note declaring the configured package", () => {
        // The point of the major: not "accepted while it agrees". An agreeing
        // declaration is exactly the ~6,200 redundant lines the sweep removed,
        // and tolerating it lets the field grow back.
        expect(() => assertNoDeclaredPackage({ package: OWN })).toThrow(
            /retired/,
        );
    });

    it("rejects a note declaring some other package", () => {
        expect(() =>
            assertNoDeclaredPackage({ package: "harnadventures" }),
        ).toThrow(/retired/);
    });

    it("rejects a declaration with no value at all", () => {
        // `package:` alone parses as null, and an empty one as "". Both are the
        // field, authored — there is no value that makes writing it correct.
        expect(() => assertNoDeclaredPackage({ package: null })).toThrow(
            /retired/,
        );
        expect(() => assertNoDeclaredPackage({ package: "" })).toThrow(
            /retired/,
        );
    });

    it("says what to do instead, naming `contentPackage` and where it lives", () => {
        let message = "";
        try {
            assertNoDeclaredPackage({ package: OWN });
        } catch (err) {
            message = (err as Error).message;
        }
        // An author fixing this needs to know where the value comes from now,
        // not only that the field is gone.
        expect(message).toContain("package:");
        expect(message).toContain("retired");
        expect(message).toContain("contentPackage");
        expect(message).toContain("package-build.config.yaml");
        expect(message).toContain(OWN);
    });

    it("names the file when it was given one", () => {
        expect(() =>
            assertNoDeclaredPackage({ package: OWN }, { file: "Gear/Axe.md" }),
        ).toThrow(/Gear\/Axe\.md/);
    });

    it("leaves the file out of the message when it was given none", () => {
        // The compile loop emits it through `noteError`, which puts the locator
        // at the start of the line — repeating it would print the path twice.
        let message = "";
        try {
            assertNoDeclaredPackage({ package: OWN });
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).not.toMatch(/\.md/);
    });

    it("names the package the caller carries, over the accessor", () => {
        let message = "";
        try {
            assertNoDeclaredPackage({ package: OWN }, { configured: "demo" });
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain("demo");
    });

    it("survives frontmatter that could not be parsed at all", () => {
        expect(() => assertNoDeclaredPackage(null)).not.toThrow();
        expect(() => assertNoDeclaredPackage(undefined)).not.toThrow();
    });

    it("carries the field's own line and column when given the file", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "note-pkg-pos-"));
        try {
            const file = path.join(tmp, "Declares.md");
            fs.writeFileSync(
                file,
                `---\ntype: doc\npackage: ${OWN}\n---\n\nProse.\n`,
                "utf8",
            );
            let position: any;
            try {
                assertNoDeclaredPackage(
                    { type: "doc", package: OWN },
                    {
                        absPath: file,
                    },
                );
            } catch (err) {
                position = (err as any).position;
            }
            // Line 1 is the opening fence, 2 is `type:`, 3 is the field.
            expect(position).toEqual({ line: 3, column: 1 });
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe("searchableFrontmatter — what a generated table searches", () => {
    it("supplies the derived package, which no note declares", () => {
        expect(searchableFrontmatter({ type: "skill" })).toEqual({
            type: "skill",
            package: OWN,
        });
    });

    it("takes the package a caller carries", () => {
        expect(searchableFrontmatter({}, "demo")).toEqual({ package: "demo" });
    });

    it("never mutates the frontmatter it was handed", () => {
        const fm = { type: "skill" };
        expect(searchableFrontmatter(fm)).not.toBe(fm);
        expect(fm).toEqual({ type: "skill" });
    });

    it("passes nothing through unchanged", () => {
        expect(searchableFrontmatter(null)).toBe(null);
        expect(searchableFrontmatter(undefined)).toBe(undefined);
    });
});

/** A note in the tree's shape, with or without a `package:` line. */
function note(fm: Record<string, unknown>, body = "Prose."): string {
    const lines = Object.entries(fm).map(
        ([k, v]) => `${k}: ${JSON.stringify(v)}`,
    );
    return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

/** The smallest consumer-shaped pass: it claims `doc` notes and writes them. */
class Probe extends BasePackCompiler {
    static override id = "probes";
    static override label = "probe";

    override selects(fm: any): boolean {
        return fm.type === "doc";
    }

    override buildEntry(fm: any, markdown: string): any {
        return {
            name: fm.name.full,
            _id: fm.id,
            body: markdown,
            folder: this.folderResolver(null),
            _key: `!probes!${fm.id}`,
        };
    }
}

const NOTE = {
    name: { full: "A Note" },
    type: "doc",
    shortcode: "anote",
    id: "AAAAAAAAAAAAAAAA",
};

describe("the compile loop refuses a note that declares `package:`", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "note-package-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** A one-note tree, and the pass that compiled it. */
    async function compileOne(
        name: string,
        fm: Record<string, unknown>,
    ): Promise<{ probe: Probe; dest: string }> {
        const root = path.join(tmp, name);
        const content = path.join(root, "content");
        const dest = path.join(root, "out");
        fs.mkdirSync(content, { recursive: true });
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(content, `${name}.md`), note(fm), "utf8");
        const probe = new Probe({ contentBase: content, dest });
        await probe.compile();
        return { probe, dest };
    }

    it("compiles a note that declares no package at all", async () => {
        const { probe, dest } = await compileOne("absent", NOTE);
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(1);
        expect(fs.readdirSync(dest)).toHaveLength(1);
    });

    it("errors on a note declaring the configured package", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { probe, dest } = await compileOne("agrees", {
                ...NOTE,
                package: OWN,
            });
            expect(probe.errorCount).toBe(1);
            expect(probe.compiledCount).toBe(0);
            expect(fs.readdirSync(dest)).toHaveLength(0);

            const lines = spy.mock.calls.map((c) => String(c[0]));
            expect(lines).toHaveLength(1);
            // `file:line:column: severity: message`, the path first, and the
            // position of the field itself (#17).
            expect(lines[0]).toMatch(/agrees\.md:\d+:\d+: error: /);
            expect(lines[0]).toContain("retired");
            expect(lines[0]).toContain("contentPackage");
        } finally {
            spy.mockRestore();
        }
    });

    it("errors, naming the file, on a note that declares another package", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { probe, dest } = await compileOne("disagrees", {
                ...NOTE,
                package: "harnadventures",
            });
            // Loud, not silent: the pass counts an error, so the build fails.
            expect(probe.errorCount).toBe(1);
            expect(probe.compiledCount).toBe(0);
            expect(fs.readdirSync(dest)).toHaveLength(0);

            const lines = spy.mock.calls.map((c) => String(c[0]));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toMatch(/disagrees\.md:\d+:\d+: error: /);
            expect(lines[0]).toContain("harnadventures");
        } finally {
            spy.mockRestore();
        }
    });

    it("counts a declined note apart from the ones another pass claims", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const root = path.join(tmp, "buckets");
            const content = path.join(root, "content");
            const dest = path.join(root, "out");
            fs.mkdirSync(content, { recursive: true });
            fs.mkdirSync(dest, { recursive: true });
            fs.writeFileSync(
                path.join(content, "Declined.md"),
                note({ ...NOTE, package: "harnadventures" }),
                "utf8",
            );
            fs.writeFileSync(
                path.join(content, "Unclaimed.md"),
                note({
                    name: { full: "Elsewhere" },
                    type: "skill",
                    shortcode: "sk",
                    id: "BBBBBBBBBBBBBBBB",
                }),
                "utf8",
            );

            const seen: any[] = [];
            class Counting extends Probe {
                override report(stats: any): void {
                    seen.push({ ...stats });
                    super.report(stats);
                }
            }
            const probe = new Counting({ contentBase: content, dest });
            await probe.compile();

            // A note the compiler *declines* is a different outcome from a note
            // that legitimately belongs to another pass, so it is not folded
            // into the same tally.
            expect(seen[0].declined).toBe(1);
            expect(seen[0].skippedOther).toBe(1);
        } finally {
            spy.mockRestore();
        }
    });
});

describe("a generated table still scopes on `package` after the sweep", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "note-package-tables-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /**
     * A collection note scoping its table with `package = "<own>"` — the shape
     * every collection note in every consumer repository has — over notes that
     * no longer declare the field. The value the clause matches is synthesised
     * for the search; it is the one place `package` survives, and 45 authored
     * clauses across `sohl` and `thalorna` rely on it.
     */
    it("matches notes that no longer declare the field", async () => {
        const content = path.join(tmp, "content");
        const dest = path.join(tmp, "out");
        fs.mkdirSync(content, { recursive: true });
        fs.mkdirSync(dest, { recursive: true });

        fs.writeFileSync(
            path.join(content, "First.md"),
            note({
                name: { full: "First" },
                type: "skill",
                shortcode: "frst",
                id: "EEEEEEEEEEEEEEEE",
            }),
            "utf8",
        );
        fs.writeFileSync(
            path.join(content, "Second.md"),
            note({
                name: { full: "Second" },
                type: "skill",
                shortcode: "scnd",
                id: "FFFFFFFFFFFFFFFF",
            }),
            "utf8",
        );
        fs.writeFileSync(
            path.join(content, "Collection.md"),
            note(
                {
                    name: { full: "Every Skill" },
                    type: "doc",
                    shortcode: "everyskill",
                    id: "0000000000000001",
                },
                [
                    "```dataview",
                    'TABLE WITHOUT ID name.full AS "Name"',
                    `WHERE type = "skill" and package = "${OWN}"`,
                    "SORT name.full ASC",
                    "```",
                ].join("\n"),
            ),
            "utf8",
        );

        const probe = new Probe({ contentBase: content, dest });
        await probe.compile();
        expect(probe.errorCount).toBe(0);

        const doc = JSON.parse(
            fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]), "utf8"),
        );
        // Without the synthesised package the query would match neither note
        // and render an empty table, in silence — the failure mode the sweep
        // would otherwise have walked straight into (#56).
        expect(doc.body).toContain("First");
        expect(doc.body).toContain("Second");
    });
});

describe("addresses are keyed from the configuration alone", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "note-package-keys-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** A one-note tree, in the shape a swept tree's notes have. */
    function tree(name: string): string {
        const root = path.join(tmp, name);
        const content = path.join(root, "assets/content");
        fs.mkdirSync(content, { recursive: true });
        fs.writeFileSync(
            path.join(content, "Climbing.md"),
            note({
                name: { full: "Climbing" },
                type: "skill",
                shortcode: "clmb",
                id: "CCCCCCCCCCCCCCCC",
            }),
            "utf8",
        );
        return root;
    }

    /** A consumer-shaped configuration rooted at a throwaway tree. */
    function configFor(root: string) {
        return defineConfig({
            rootDir: root,
            contentPackage: OWN,
            foundryPackage: "demo-module",
            packageKind: "modules",
            stats: {
                lastModifiedBy: "demobuilder0000",
            },
            packs: [
                { name: "items", type: "Item" },
                { name: "journals", type: "JournalEntry" },
            ],
            publish: { site: "content", manifests: { publish: true } },
        });
    }

    it("indexes the canonical link address for a note declaring nothing", () => {
        const root = tree("links");
        const index = buildLinkIndex(path.join(root, "assets/content"));
        // The package-qualified form is what a cross-package link writes.
        expect(
            index.resolve({ type: "doc" }, `${OWN}-skill-clmb`),
        ).toBeTruthy();
        expect(index.packages.has(OWN)).toBe(true);
    });

    it("keys the link manifest from `contentPackage`", () => {
        const root = tree("manifest");
        const { entries } = collectManifestEntries(
            path.join(root, "assets/content"),
            manifestContext(configFor(root)),
        );
        expect(entries.map((e: any) => e.key)).toContain(`${OWN}-skill-clmb`);
    });

    it("refuses a manifest note that declares the field", () => {
        const root = path.join(tmp, "manifest-declares");
        const content = path.join(root, "assets/content");
        fs.mkdirSync(content, { recursive: true });
        fs.writeFileSync(
            path.join(content, "Declares.md"),
            note({
                name: { full: "Declares" },
                type: "skill",
                shortcode: "dcls",
                id: "DDDDDDDDDDDDDDDD",
                package: OWN,
            }),
            "utf8",
        );
        expect(() =>
            collectManifestEntries(content, manifestContext(configFor(root))),
        ).toThrow(/retired/);
    });
});
