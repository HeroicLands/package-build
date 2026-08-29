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
 * This suite pins the first of the three steps that retire it: the field is
 * **optional**, a value that agrees is accepted, and a value that disagrees is a
 * loud error naming the file. Nothing here requires a consumer to change a
 * note, which is what makes the sweep (step 2) safe to land afterwards.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    notePackage,
    assertNotePackage,
    searchableFrontmatter,
} from "../engine/note-package.mjs";
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

describe("notePackage — the package a note belongs to", () => {
    it("is the configured package when the note declares none", () => {
        expect(notePackage({ type: "doc" })).toBe(OWN);
    });

    it("is the configured package when the note declares it", () => {
        expect(notePackage({ package: OWN })).toBe(OWN);
    });

    it("treats a blank declaration as no declaration", () => {
        expect(notePackage({ package: "" })).toBe(OWN);
    });

    it("takes the package a caller already carries, over the accessor", () => {
        // `collectManifestEntries` holds the configured package in its context
        // rather than reading the accessor, so the derivation accepts one.
        expect(notePackage({}, "demo")).toBe("demo");
        expect(notePackage({ package: "demo" }, "demo")).toBe("demo");
    });

    it("survives frontmatter that could not be parsed at all", () => {
        expect(notePackage(null)).toBe(OWN);
        expect(notePackage(undefined)).toBe(OWN);
    });
});

describe("assertNotePackage — a disagreeing declaration is an error", () => {
    it("accepts a note that declares nothing", () => {
        expect(assertNotePackage({ type: "doc" })).toBe(OWN);
    });

    it("accepts a note that declares the configured package", () => {
        expect(assertNotePackage({ package: OWN })).toBe(OWN);
    });

    it("throws naming both packages and the file it was given", () => {
        const boom = () =>
            assertNotePackage(
                { package: "harnadventures" },
                { file: "Gear/Axe.md" },
            );
        expect(boom).toThrow(/harnadventures/);
        expect(boom).toThrow(new RegExp(OWN));
        expect(boom).toThrow(/Gear\/Axe\.md/);
    });

    it("leaves the file out of the message when it was given none", () => {
        // The compile loop emits it through `noteError`, which puts the locator
        // at the start of the line — repeating it would print the path twice.
        let message = "";
        try {
            assertNotePackage({ package: "elsewhere" });
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toMatch(/elsewhere/);
        expect(message).not.toMatch(/\.md/);
    });

    it("compares against the package it is given, not only the configured one", () => {
        expect(() =>
            assertNotePackage({ package: OWN }, { configured: "demo" }),
        ).toThrow(new RegExp(OWN));
        expect(
            assertNotePackage({ package: "demo" }, { configured: "demo" }),
        ).toBe("demo");
    });
});

describe("searchableFrontmatter — what a generated table searches", () => {
    it("supplies the derived package when the note declares none", () => {
        expect(searchableFrontmatter({ type: "skill" })).toEqual({
            type: "skill",
            package: OWN,
        });
    });

    it("hands back the frontmatter untouched when it declares one", () => {
        const fm = { type: "skill", package: OWN };
        expect(searchableFrontmatter(fm)).toBe(fm);
    });

    it("takes the package a caller carries", () => {
        expect(searchableFrontmatter({}, "demo")).toEqual({ package: "demo" });
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

describe("the compile loop no longer selects by `package:`", () => {
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

    it("compiles a note that declares the configured package", async () => {
        const { probe, dest } = await compileOne("agrees", {
            ...NOTE,
            package: OWN,
        });
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(1);
        expect(fs.readdirSync(dest)).toHaveLength(1);
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
            // `file:line:column: severity: message`, the path first (#17).
            expect(lines[0]).toMatch(/disagrees\.md: error: /);
            expect(lines[0]).toContain("harnadventures");
            expect(lines[0]).toContain(OWN);
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
     * every collection note in every consumer repository has — over one note
     * that declares the field and one that does not.
     */
    it("matches a note that no longer declares the field", async () => {
        const content = path.join(tmp, "content");
        const dest = path.join(tmp, "out");
        fs.mkdirSync(content, { recursive: true });
        fs.mkdirSync(dest, { recursive: true });

        fs.writeFileSync(
            path.join(content, "Declares.md"),
            note({
                name: { full: "Declares" },
                type: "skill",
                shortcode: "decl",
                id: "EEEEEEEEEEEEEEEE",
                package: OWN,
            }),
            "utf8",
        );
        fs.writeFileSync(
            path.join(content, "Silent.md"),
            note({
                name: { full: "Silent" },
                type: "skill",
                shortcode: "slnt",
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
        // Without the derived package the query would match neither note and
        // render an empty table, in silence — the failure mode a sweep would
        // otherwise walk straight into (#56).
        expect(doc.body).toContain("Declares");
        expect(doc.body).toContain("Silent");
    });
});

describe("addresses are derived identically with and without the field", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "note-package-keys-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** A one-note tree, with the field or without it. */
    function tree(name: string, declares: boolean): string {
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
                ...(declares ? { package: OWN } : {}),
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
                systemId: "sohl",
                systemVersion: "1.0.0",
                lastModifiedBy: "demobuilder0000",
            },
            packs: [
                { name: "items", type: "Item" },
                { name: "journals", type: "JournalEntry" },
            ],
            publish: { site: true, manifests: { publish: true } },
        });
    }

    it("indexes the canonical link address either way", () => {
        for (const declares of [true, false]) {
            const root = tree(`links-${declares}`, declares);
            const index = buildLinkIndex(path.join(root, "assets/content"));
            // The package-qualified form is what a cross-package link writes.
            expect(
                index.resolve({ type: "doc" }, `${OWN}-skill-clmb`),
            ).toBeTruthy();
            expect(index.packages.has(OWN)).toBe(true);
        }
    });

    it("keys the link manifest either way", () => {
        const keys = [true, false].map((declares) => {
            const root = tree(`manifest-${declares}`, declares);
            const { entries } = collectManifestEntries(
                path.join(root, "assets/content"),
                manifestContext(configFor(root)),
            );
            return entries.map((e: any) => e.key).sort();
        });
        expect(keys[0]).toEqual(keys[1]);
        expect(keys[0]).toContain(`${OWN}-skill-clmb`);
    });

    it("refuses a manifest note that declares another package", () => {
        const root = path.join(tmp, "manifest-foreign");
        const content = path.join(root, "assets/content");
        fs.mkdirSync(content, { recursive: true });
        fs.writeFileSync(
            path.join(content, "Foreign.md"),
            note({
                name: { full: "Foreign" },
                type: "skill",
                shortcode: "frgn",
                id: "DDDDDDDDDDDDDDDD",
                package: "harnadventures",
            }),
            "utf8",
        );
        expect(() =>
            collectManifestEntries(content, manifestContext(configFor(root))),
        ).toThrow(/harnadventures/);
    });
});
