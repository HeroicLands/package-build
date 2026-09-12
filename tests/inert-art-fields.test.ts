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
 * An `img:` authored on a type that emits none is dropped in silence.
 *
 * The defect these pin: `img` is a **shared top-level** field —
 * `BLOCK_DOCUMENT_PROPERTIES` maps it onto `document.img`, so it is legal on
 * every note whatever the type — and a note whose document has no such property
 * authors it, validates, compiles, and loses the value with nothing said.
 * `Parrot` in `sohl-thalorna` is the case in hand: `type: lore`, so it compiles
 * into a JournalEntry, and it had declared `img: images/mystery/parrot.webp`
 * since long before the art rule was written. It compiles `img: null`, exactly
 * as a note declaring nothing does.
 *
 * Two halves, and the second is the one that keeps the first honest:
 *
 * 1. the frontmatter lint **reports** an art key on a type that emits none; and
 * 2. which types those are is **derived from the passes** — each declares the
 *    art it writes, and the derivation walks type → document → pass. A list of
 *    iconless types kept anywhere else would be a list free to drift from what
 *    is actually emitted, which is the defect rather than the check.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { emittedArtFor } from "../engine/generate.mjs";
import { Journals } from "../engine/journals.mjs";
import { Macros } from "../engine/macros.mjs";
import { Scenes } from "../engine/scenes.mjs";
import { Bundles } from "../engine/bundles.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Hm3Items } from "../hm3/items.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";

/* -------------------------------------------------------------------- */
/*  The passes declare their own art                                     */
/* -------------------------------------------------------------------- */

/** Every compiler the generator can hand a pack to. */
const SHIPPED: [string, typeof BasePackCompiler][] = [
    ["Items", Items as never],
    ["Hm3Items", Hm3Items as never],
    ["Journals", Journals as never],
    ["Actors", Actors as never],
    ["Hm3Actors", Hm3Actors as never],
    ["Macros", Macros as never],
    ["Scenes", Scenes as never],
    ["Bundles", Bundles as never],
];

/**
 * The class in a compiler's chain that states `emitsArt` — `BasePackCompiler`
 * where the pass never said and merely inherited the empty default.
 */
function declaringClass(cls: any): any {
    for (let c = cls; c && c !== Object.prototype; c = Object.getPrototypeOf(c)) {
        if (Object.hasOwn(c, "emitsArt")) return c;
    }
    return null;
}

describe("every shipped pass declares the art it emits", () => {
    it.each(SHIPPED)("%s says so for itself rather than inheriting the default", (_name, cls) => {
        // The guard that makes the derivation trustworthy: the empty default
        // exists so a *consumer's* new pass is not forced to care, but a pass
        // this package ships must state its own, or "emits no art" would be
        // indistinguishable from "never said" — and the lint would tell an
        // author to delete a key that works.
        expect(declaringClass(cls)).not.toBe(BasePackCompiler);
    });

    it("says the journals pass emits none, which is the case in hand", () => {
        expect([...Journals.emitsArt]).toEqual([]);
    });

    it("says an actor pass emits both, since a being carries two pictures", () => {
        expect([...Actors.emitsArt].sort()).toEqual(["img", "portrait"]);
        expect([...Hm3Actors.emitsArt].sort()).toEqual(["img", "portrait"]);
    });

    it("says an item pass emits an icon and no portrait", () => {
        expect([...Items.emitsArt]).toEqual(["img"]);
    });
});

/* -------------------------------------------------------------------- */
/*  …and the declaration is what actually reaches the document           */
/* -------------------------------------------------------------------- */

/** A note in the tree's shape. */
function note(body: string, fm: Record<string, unknown>): string {
    const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

const AUTHORED_ART = "images/mystery/parrot.webp";

describe("the declaration matches what a pass actually emits", () => {
    let tmp: string;
    let content: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-inert-art-"));
        content = path.join(tmp, "content");
        fs.mkdirSync(content, { recursive: true });
        fs.writeFileSync(
            path.join(content, "Parrot.md"),
            note("A bird of the totem traditions.", {
                name: { full: "Parrot" },
                id: "PARROTPARROT001",
                shortcode: "parrotttm",
                type: "lore",
                img: AUTHORED_ART,
            }),
        );
        fs.writeFileSync(
            path.join(content, "Roll.md"),
            note("# Script {#script}\n\n```js\nconsole.log(1);\n```", {
                name: { full: "Roll Something" },
                id: "MACROMACROMAC001",
                shortcode: "rollsomething",
                type: "macro",
                img: AUTHORED_ART,
            }),
        );
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** Every emitted document in a directory. */
    function read(dir: string): any[] {
        return fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".json"))
            .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    }

    async function compile(Pass: any): Promise<any[]> {
        const out = fs.mkdtempSync(path.join(tmp, "out-"));
        const pack = new Pass({ skipDirectories: [], contentBase: content, dest: out });
        await pack.compile();
        return read(out);
    }

    it("declares none for the journals pass, and the path indeed reaches nothing", async () => {
        // The whole defect, asserted from the output rather than from the
        // declaration: the note compiles, and the authored path is gone.
        const docs = await compile(Journals);
        const parrot = docs.find((d) => d.name === "Parrot");
        expect(parrot).toBeDefined();
        expect(JSON.stringify(parrot)).not.toContain(AUTHORED_ART);
        expect(Journals.emitsArt).toHaveLength(0);
    });

    it("declares `img` for the macros pass, and the path indeed reaches the document", async () => {
        const docs = await compile(Macros);
        const macro = docs.find((d) => d.name === "Roll Something");
        expect(macro).toBeDefined();
        expect(macro.img).toContain("parrot.webp");
        expect([...Macros.emitsArt]).toEqual(["img"]);
    });
});

/* -------------------------------------------------------------------- */
/*  The derivation: type → document → pass                               */
/* -------------------------------------------------------------------- */

describe("emittedArtFor answers from the routing the compile follows", () => {
    it("gives a journal type its document and no art", () => {
        expect(emittedArtFor("lore")).toEqual({ document: "JournalEntry", art: [] });
        for (const type of ["doc", "place", "scenario"]) {
            expect(emittedArtFor(type)!.art).toEqual([]);
        }
    });

    it("gives a being both fields, from the actor pass's own declaration", () => {
        const being = emittedArtFor("being")!;
        expect(being.document).toBe("Actor");
        expect([...being.art].sort()).toEqual(["img", "portrait"]);
    });

    it("gives an item type its icon", () => {
        // An open-set type: nothing names `weapon` in the routing table, and it
        // takes the Item default — which is exactly how the compile resolves it.
        expect(emittedArtFor("weapon")).toEqual({ document: "Item", art: ["img"] });
    });

    it("gives a macro, a map and a bundle their art", () => {
        expect(emittedArtFor("macro")).toEqual({ document: "Macro", art: ["img"] });
        expect(emittedArtFor("map")).toEqual({ document: "Scene", art: ["img"] });
        expect(emittedArtFor("bundle")).toEqual({ document: "Adventure", art: ["img"] });
    });

    it("says a folder carries none — a Foundry Folder has no artwork", () => {
        // It reaches a pack by a route of its own, so the pack router has no
        // answer for it and no compiler class writes it; `folderDocument` does.
        expect(emittedArtFor("folder")).toEqual({ document: "Folder", art: [] });
    });

    it("says a homepage reaches no document at all", () => {
        expect(emittedArtFor("homepage")).toEqual({ document: null, art: [] });
    });

    it("makes no claim about a retired type, which is reported as retired instead", () => {
        expect(emittedArtFor("character")).toBeNull();
        expect(emittedArtFor("")).toBeNull();
    });

    it("answers a renamed type as its current spelling", () => {
        // Every type-keyed lookup normalises through `currentType`, so a tree
        // still on `armor` gets the same answer a swept one does — which is
        // what keeps the check from reporting an unswept note's live `img:`.
        expect(emittedArtFor("armor")).toEqual(emittedArtFor("armorgear"));
        expect(emittedArtFor("armor")).toEqual({ document: "Item", art: ["img"] });
    });
});

/* -------------------------------------------------------------------- */
/*  The finding                                                          */
/* -------------------------------------------------------------------- */

const SCHEMAS = { lore: [], being: [], doc: [], homepage: [] } as never;

/** Lint one note's frontmatter, with the real derivation wired in. */
function lint(fm: Record<string, unknown>, raw?: string): any[] {
    const text =
        raw ??
        `---\n${Object.entries(fm)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join("\n")}\n---\n`;
    return lintNote(
        { fm, file: "Parrot.md", raw: text } as never,
        {
            schemas: SCHEMAS,
            emittedArt: emittedArtFor,
        } as never,
    );
}

/** The findings this check makes, by their message. */
function inertArt(findings: any[]): any[] {
    return findings.filter((f) => String(f.message).includes("reaches no document"));
}

describe("the frontmatter lint reports an art key the type never emits", () => {
    it("reports `img:` on a lore note, naming the key and what it compiles into", () => {
        const [finding, ...rest] = inertArt(lint({ type: "lore", img: AUTHORED_ART }));
        expect(rest).toEqual([]);
        expect(finding.severity).toBe("warning");
        expect(finding.file).toBe("Parrot.md");
        expect(finding.message).toContain("`img:`");
        expect(finding.message).toContain("`lore`");
        expect(finding.message).toContain("JournalEntry");
    });

    it("locates the key in the file, so the finding is a compiler-parseable line", () => {
        const raw = `---\ntype: lore\nshortcode: parrotttm\nimg: ${AUTHORED_ART}\n---\n`;
        const [finding] = inertArt(lint({ type: "lore", img: AUTHORED_ART }, raw));
        expect(finding.line).toBe(4);
        expect(finding.column).toBeGreaterThan(0);
    });

    it("reports it inside the system block too, which is the other position", () => {
        expect(inertArt(lint({ type: "lore", sohl: { img: AUTHORED_ART } }))).toHaveLength(1);
    });

    it('reports an `img: ""` once, as inert rather than as a lost default', () => {
        // Both rules could fire on this note. Only the one that is true does:
        // where nothing is emitted there is no default art to fall back to, so
        // the `""`-versus-`null` distinction has nothing to distinguish.
        const findings = lint({ type: "lore", img: "" });
        expect(inertArt(findings)).toHaveLength(1);
        expect(findings.filter((f) => String(f.message).includes("ship no art at all"))).toEqual(
            [],
        );
    });

    it("says nothing about `img: null`, which is the blessed way to name none", () => {
        // Twenty-six `sohl-thalorna` place notes are in this state. The key
        // compiles identically to writing nothing at all, so a finding on each
        // would bury the ones that name a path their author believes ships.
        expect(inertArt(lint({ type: "place", img: null }))).toEqual([]);
        expect(inertArt(lint({ type: "place" }))).toEqual([]);
    });

    it("says a homepage compiles into a page rather than a document", () => {
        const [finding] = inertArt(lint({ type: "homepage", img: AUTHORED_ART }));
        expect(finding.message).toContain("page rather than a compendium document");
    });

    it("leaves a live art key alone", () => {
        expect(inertArt(lint({ type: "being", img: AUTHORED_ART }))).toEqual([]);
        expect(inertArt(lint({ type: "being", portrait: AUTHORED_ART }))).toEqual([]);
    });

    it("reports a `portrait:` on a type that emits no portrait", () => {
        // An item has an icon and nowhere to put a sheet portrait, so the two
        // fields answer differently for one note — which is why the check is
        // per field rather than per type.
        const findings = inertArt(lint({ type: "lore", portrait: AUTHORED_ART }));
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("`portrait:`");
    });

    it("makes no claim at all when the caller supplies no derivation", () => {
        // The pattern `index` and `vocabulary` set: an option's absence skips
        // its check rather than reporting every note.
        const findings = lintNote(
            { fm: { type: "lore", img: AUTHORED_ART }, file: "Parrot.md", raw: "" } as never,
            { schemas: SCHEMAS } as never,
        );
        expect(inertArt(findings)).toEqual([]);
    });
});
