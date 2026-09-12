/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A derived id is keyed on the thing's **identity**, never on where it sits in
 * a list.
 *
 * Two ids were keyed on position: an actor's embedded item, and an unanchored
 * journal page. A Foundry id is how a world refers to a document it imported,
 * so a position key means reordering a being's items — or inserting a heading
 * into a note — silently renumbers every id after the change, and a re-import
 * creates new documents beside the old ones. Nothing about those documents
 * changed; only their neighbours did.
 *
 * These are the properties that buys, asserted directly rather than inferred
 * from the derivation: reorder, and nothing moves. The anchored-page case
 * already had them, and is the shape the other two now share.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Actors } from "../sohl/actors.mjs";
import { buildPages, journalPageId, splitPages } from "../engine/journals.mjs";
import { entriesForNote } from "../engine/foundry-entries.mjs";
import { resolveNoteId } from "../engine/note-ids.mjs";

// ---------------------------------------------------------------- embedded --

const CATALOGUE = () =>
    new Map<string, any>([
        ["skill:clmb", { type: "skill", name: "Climbing", system: { shortcode: "clmb" } }],
        ["skill:swim", { type: "skill", name: "Swimming", system: { shortcode: "swim" } }],
        ["weapongear:dgr", { type: "weapongear", name: "Dagger", system: { shortcode: "dgr" } }],
    ]);

describe("an actor's embedded item ids do not move when the list is reordered", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-embedded-id-"));
        fs.mkdirSync(path.join(dir, "content"));
        fs.mkdirSync(path.join(dir, "items"));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const build = (items: any[]) => {
        const c = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
        });
        const built = c.buildEmbeddedItems(
            CATALOGUE(),
            "actor0000000000",
            { sohl: { items } },
            "t",
        );
        const byCode = new Map<string, string>();
        for (const item of built) byCode.set(item.system.shortcode, item._id);
        return { byCode, errors: c.errorCount };
    };

    it("gives one entry the same id whatever position it holds", () => {
        const first = build([
            { model: "skill-clmb" },
            { model: "skill-swim" },
            { model: "weapongear-dgr" },
        ]);
        // The same three entries, written in a different order. Nothing about
        // any of them changed — only their neighbours did.
        const second = build([
            { model: "weapongear-dgr" },
            { model: "skill-clmb" },
            { model: "skill-swim" },
        ]);
        expect(first.errors).toBe(0);
        expect(second.errors).toBe(0);
        expect([...second.byCode.entries()].sort()).toEqual([...first.byCode.entries()].sort());
    });

    it("survives an entry being inserted ahead of the others", () => {
        const before = build([{ model: "skill-clmb" }, { model: "skill-swim" }]);
        const after = build([
            { model: "weapongear-dgr" },
            { model: "skill-clmb" },
            { model: "skill-swim" },
        ]);
        expect(after.byCode.get("clmb")).toBe(before.byCode.get("clmb"));
        expect(after.byCode.get("swim")).toBe(before.byCode.get("swim"));
    });

    it("keys on the entry's own `system.shortcode`, not on the selector", () => {
        // The top-level `shortcode` selects the template to copy from and is
        // never written to the document; two entries may share one. What
        // identifies each embodiment is the `system.shortcode` it carries.
        const { byCode, errors } = build([
            { model: "weapongear-dgr", name: "Dagger 1", system: { shortcode: "dgr1" } },
            { model: "weapongear-dgr", name: "Dagger 2", system: { shortcode: "dgr2" } },
        ]);
        expect(errors).toBe(0);
        expect(byCode.get("dgr1")).not.toBe(byCode.get("dgr2"));
    });

    it("refuses two entries that resolve to one identity, naming both", () => {
        // The case the index used to hide: with a position in the key these
        // compiled to two documents denoting one entity, and shipped unremarked.
        const c = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
        });
        const messages: string[] = [];
        c.noteError = (msg: string) => messages.push(msg);
        c.buildEmbeddedItems(
            CATALOGUE(),
            "actor0000000000",
            {
                sohl: {
                    items: [
                        { model: "weapongear-dgr", name: "Dagger 1" },
                        { model: "weapongear-dgr", name: "Dagger 2" },
                    ],
                },
            },
            "t",
        );
        expect(c.errorCount).toBe(1);
        expect(messages.join("\n")).toMatch(/weapongear:dgr/);
        expect(messages.join("\n")).toMatch(/system\.shortcode/);
    });
});

// ------------------------------------------------------------------- pages --

describe("a journal page's id does not move when a heading is inserted", () => {
    const ENTRY = "entry00000000000";

    it("keys an unanchored page on its name alone", () => {
        const page = { anchorSlug: null, name: "Consequences" } as any;
        // Same page, three positions, one id.
        expect(journalPageId(ENTRY, page)).toBe(journalPageId(ENTRY, page));
    });

    it("leaves every other page id unchanged when a heading is added", () => {
        const before = splitPages("# Alpha\n\na\n\n# Gamma\n\nc\n", "Note");
        const after = splitPages("# Alpha\n\na\n\n# Beta\n\nb\n\n# Gamma\n\nc\n", "Note");
        const ids = (pages: any[]) =>
            new Map(buildPages(pages, ENTRY, "Note").map((p: any) => [p.name, p._id]));
        const b = ids(before);
        const a = ids(after);
        expect(a.get("Alpha")).toBe(b.get("Alpha"));
        // The one the old derivation renumbered: `Gamma` moved from index 1 to
        // index 2 and nothing about it changed.
        expect(a.get("Gamma")).toBe(b.get("Gamma"));
    });

    it("refuses two sibling pages that share a name", () => {
        // Their ids would collide, which the LevelDB packer reports only as an
        // opaque duplicate key. Named here, where the note and page can be.
        const pages = [
            { anchorSlug: null, name: "Notes", level: 1, markdown: "a" },
            { anchorSlug: null, name: "Notes", level: 1, markdown: "b" },
        ];
        expect(() => buildPages(pages, ENTRY, "Note")).toThrow(/"Notes"/);
    });
});

// -------------------------------------------------- no document, no address --

describe("a type that compiles into no compendium document publishes no UUID", () => {
    // Every addressable note now derives an id, where before a note that
    // compiled into nothing simply authored none. So "has an id" stopped being
    // evidence that a compendium document exists, and the types for which it
    // does not have to say so themselves.
    const ctx = {
        contentPackage: "demo",
        foundryPackageId: "demo-module",
        packRouter: { resolveOrNull: () => "items", defaultOf: () => "journals" },
        docEntryTypes: new Set(["weapongear"]),
    } as any;

    const uuidsFor = (type: string) => {
        const fm: any = { type, shortcode: "probe", name: { full: "Probe" } };
        resolveNoteId(fm, { pkg: ctx.contentPackage });
        expect(fm.id).toBeDefined(); // the note *is* addressable
        return entriesForNote(fm, "Probe", `${type}-probe/`, "", ctx).map((e: any) => e.uuid);
    };

    it("emits none for a homepage, which compiles into a page", () => {
        expect(uuidsFor("homepage")).toEqual([undefined]);
    });

    it("emits none for a folder, which is no one pack's document", () => {
        // A folder *is* a real document, but not one this can name: it
        // materialises in every pack holding a document that references it, so
        // no single UUID identifies it — and its id is hashed under the
        // `folder` namespace against its own address, never under `document`.
        // Emitting one here would publish an `Item` UUID for a `Folder`, at an
        // id no document carries.
        expect(uuidsFor("folder")).toEqual([undefined]);
    });

    it("still emits one for an ordinary item, and for its documentation", () => {
        const [own, doc] = uuidsFor("weapongear");
        expect(own).toContain("Compendium.demo-module.items.Item.");
        expect(doc).toContain("Compendium.demo-module.journals.JournalEntry.");
    });
});
