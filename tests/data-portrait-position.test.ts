/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A `data:` source has a retiring top-level spelling, and it is read**.
 *
 * `data:` did not invent the facts it holds — it gathered them out of
 * the note's open top level, where `portrait:` sat beside `img:` and
 * `shortcode:`. So a field declaring `data.portrait` has *two* shared
 * spellings, and the resolver knows only about the retiring **in-block**
 * one. Step 3 read the declared source and stopped.
 *
 * The being emitter never went through the resolver at all: it read
 * `blockProperty(fm, SYSTEM, "portrait")`, which knows the system block and the
 * note's top level and never splits a dotted path, so `data.portrait` was
 * invisible to it — and the `?? defaultImg` on the next line turned every miss
 * into the generic person icon rather than into a complaint. 646
 * `sohl-thalorna` beings authored a portrait, 341 of them pointing at art that
 * exists on disk, and every one compiled the default. Deterministically, and
 * with nothing said.
 *
 * Two things had to be true at once, which is what makes this a resolution-order
 * fix rather than a one-line emitter fix:
 *
 * - `data.portrait` — what the specification's `being` mapping table names —
 *   must reach the document;
 * - top-level `portrait:` must keep working, because `sohl`'s own bestiary
 *   writes it on every note and the sweep has not run.
 *
 * So the resolver gained step 3b, and it is **derived** rather than declared:
 * the retiring spelling of `data.<key>` is `<key>`, because that is precisely
 * what the sweep did. A `protection.blunt` was never a `blunt:`, so it has none.
 */

import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveFieldValue, retiredTopLevelKey } from "../engine/system-block.mjs";
import { readField, readsRetiredTopLevel, STRING } from "../engine/field-spec.mjs";
import { retiredTopLevelMessage } from "../engine/retired-fields.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The field the issue is written about, as `sohl/actors.mjs` declares it. */
const PORTRAIT = Object.freeze({
    name: "data.portrait",
    legacyKey: "portrait",
    to: "portrait",
    ...STRING,
    default: "",
    describe: "Path to the portrait image.",
});

/* --------------------------------------------------------------------- */
/*  The derivation                                                        */
/* --------------------------------------------------------------------- */

describe("retiredTopLevelKey", () => {
    it("strips the `data.` a field's shared source declares", () => {
        expect(retiredTopLevelKey(PORTRAIT)).toBe("portrait");
        expect(retiredTopLevelKey({ name: "data.species" })).toBe("species");
    });

    it("keeps a nested `data:` path nested, so it addresses the same fact", () => {
        // `data.appearance.eye_color` was `appearance.eye_color` at the top
        // level, not `eye_color`: #128 moved the container, not its leaves.
        expect(retiredTopLevelKey({ name: "data.appearance.eye_color" })).toBe(
            "appearance.eye_color",
        );
    });

    it("answers for a `data.` source alone", () => {
        // A path into a container a note has *always* written at the top level.
        // Reading `blunt:` or `die:` would invent a position rather than
        // remember one — nothing was ever authored there.
        expect(retiredTopLevelKey({ name: "protection.blunt" })).toBeUndefined();
        expect(retiredTopLevelKey({ name: "impact.die" })).toBeUndefined();
        expect(retiredTopLevelKey({ name: "img" })).toBeUndefined();
    });

    it("answers for nothing when there is no source, or nothing after the prefix", () => {
        expect(retiredTopLevelKey({})).toBeUndefined();
        expect(retiredTopLevelKey({ name: "data." })).toBeUndefined();
        expect(retiredTopLevelKey(undefined as never)).toBeUndefined();
    });
});

/* --------------------------------------------------------------------- */
/*  The resolution order, with step 3b in it                              */
/* --------------------------------------------------------------------- */

describe("resolving a `data:`-sourced field", () => {
    it("reads the declared `data:` source — the position the specification names", () => {
        expect(
            resolveFieldValue(PORTRAIT, { data: { portrait: "images/a.webp" } }, { block: "sohl" }),
        ).toEqual({ value: "images/a.webp", from: "shared" });
    });

    it("reads the retiring top-level key, which `data:` gathered the fact off", () => {
        // The whole point: this is what `sohl`'s bestiary writes, on every
        // note, and it reached the resolver as an absence.
        expect(
            resolveFieldValue(PORTRAIT, { portrait: "images/b.webp" }, { block: "sohl" }),
        ).toEqual({ value: "images/b.webp", from: "topLevel" });
    });

    it("prefers the current `data:` spelling to the retiring one", () => {
        expect(
            resolveFieldValue(
                PORTRAIT,
                { data: { portrait: "images/a.webp" }, portrait: "images/b.webp" },
                { block: "sohl" },
            ),
        ).toEqual({ value: "images/a.webp", from: "shared" });
    });

    it("still lets the in-block key win over both, as step 2 always did", () => {
        expect(
            resolveFieldValue(
                PORTRAIT,
                {
                    data: { portrait: "images/a.webp" },
                    portrait: "images/b.webp",
                    sohl: { portrait: "images/c.webp" },
                },
                { block: "sohl" },
            ),
        ).toEqual({ value: "images/c.webp", from: "block" });
    });

    it("still lets the destination path win over everything", () => {
        expect(
            resolveFieldValue(
                PORTRAIT,
                {
                    data: { portrait: "images/a.webp" },
                    portrait: "images/b.webp",
                    sohl: { portrait: "images/c.webp", system: { portrait: "images/d.webp" } },
                },
                { block: "sohl" },
            ),
        ).toEqual({ value: "images/d.webp", from: "system" });
    });

    it("falls to the default when no position carries it", () => {
        expect(resolveFieldValue(PORTRAIT, { name: { full: "x" } }, { block: "sohl" })).toEqual({
            value: "",
            from: "default",
        });
    });

    it("reads no top-level key at all for a field that declares `topLevelMeans`", () => {
        // The opt-out removes the shared *level*, not one spelling of it: the
        // objection is that the note's top level means something else here, and
        // that is as true of the retiring position as of the current one.
        const exempt = { ...PORTRAIT, topLevelMeans: "the note's own heading" };
        expect(
            resolveFieldValue(
                exempt,
                { portrait: "images/b.webp", data: { portrait: "images/a.webp" } },
                { block: "sohl" },
            ),
        ).toEqual({ value: "", from: "default" });
    });

    it("leaves a non-`data:` shared source resolving exactly as it did", () => {
        // The guard on the whole change: every declared field has a
        // bare or non-`data.` source, so none of them gained a position.
        const blunt = { name: "protection.blunt", to: "protection.blunt", ...STRING, default: "" };
        expect(resolveFieldValue(blunt, { blunt: "5" }, { block: "sohl" })).toEqual({
            value: "",
            from: "default",
        });
    });
});

/* --------------------------------------------------------------------- */
/*  Nothing is dropped in silence                                         */
/* --------------------------------------------------------------------- */

describe("the retiring top-level position is reported", () => {
    it("is what `readsRetiredTopLevel` counts, and only that", () => {
        expect(readsRetiredTopLevel(PORTRAIT, "topLevel")).toBe(true);
        expect(readsRetiredTopLevel(PORTRAIT, "shared")).toBe(false);
        expect(readsRetiredTopLevel(PORTRAIT, "block")).toBe(false);
        expect(readsRetiredTopLevel(PORTRAIT, "default")).toBe(false);
    });

    it("calls back once, naming the field, when a note is read from it", () => {
        const onRetiredTopLevel = vi.fn();
        readField(PORTRAIT, { portrait: "images/b.webp" }, { block: "sohl", onRetiredTopLevel });
        expect(onRetiredTopLevel).toHaveBeenCalledTimes(1);
        expect(onRetiredTopLevel).toHaveBeenCalledWith(PORTRAIT);
    });

    it("stays quiet for a note already on `data:`", () => {
        const onRetiredTopLevel = vi.fn();
        readField(
            PORTRAIT,
            { data: { portrait: "images/a.webp" } },
            { block: "sohl", onRetiredTopLevel },
        );
        expect(onRetiredTopLevel).not.toHaveBeenCalled();
    });

    it("says which spelling moves where, and that the value is unaffected", () => {
        const message = retiredTopLevelMessage(PORTRAIT);
        expect(message).toContain("top-level `portrait:`");
        expect(message).toContain("`data.portrait:`");
        expect(message).toContain("Both are read");
    });
});

/* --------------------------------------------------------------------- */
/*  The emitters — the acceptance criteria themselves                     */
/* --------------------------------------------------------------------- */

/** The SoHL Actor compiler. Nothing here walks a tree or reads a pack. */
function actors() {
    const config = loadPackConfig();
    return new Actors({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
}

/** The HM3 Actor compiler, likewise. */
function hm3Actors() {
    const config = loadPackConfig();
    return new Hm3Actors({
        skipDirectories: [],
        contentBase: path.join(PKG_ROOT, "tests/fixtures"),
        dest: config.paths.packJson,
    });
}

/** A being note, with whatever art positions a case needs. */
const beingNote = (extra: Record<string, unknown>) => ({
    id: "EEEEEEEEEEEEEEEE",
    type: "being",
    shortcode: "folk",
    name: { full: "Basic Folk" },
    data: { templatePriority: null },
    ...extra,
});

/** The generic person icon a miss used to compile to. */
const DEFAULT_BEING_ART = "systems/sohl/assets/icons/game-icons/delapouite/person.svg";

describe("a SoHL being's `system.portrait`", () => {
    it("carries the path authored at `data.portrait`, resolved through resolveImg", () => {
        const doc = actors().buildBeing(
            new Map(),
            beingNote({ data: { templatePriority: null, portrait: "images/beings/akhr.webp" } }),
            "",
        );
        expect(doc.system.portrait).toBe("systems/sohl/assets/images/beings/akhr.webp");
    });

    it("keeps honouring the legacy top-level `portrait:` the bestiary writes", () => {
        const doc = actors().buildBeing(
            new Map(),
            beingNote({ portrait: "images/being/donkey-portrait.webp" }),
            "",
        );
        expect(doc.system.portrait).toBe("systems/sohl/assets/images/being/donkey-portrait.webp");
    });

    it("prefers `data.portrait` where a note carries both", () => {
        const doc = actors().buildBeing(
            new Map(),
            beingNote({
                data: { templatePriority: null, portrait: "images/new.webp" },
                portrait: "images/old.webp",
            }),
            "",
        );
        expect(doc.system.portrait).toBe("systems/sohl/assets/images/new.webp");
    });

    it("still defaults to the subtype's art when no position names one", () => {
        expect(actors().buildBeing(new Map(), beingNote({}), "").system.portrait).toBe(
            DEFAULT_BEING_ART,
        );
    });

    it('still ships blank for a deliberate `""`, at either shared position', () => {
        expect(
            actors().buildBeing(new Map(), beingNote({ portrait: "" }), "").system.portrait,
        ).toBe("");
        expect(
            actors().buildBeing(
                new Map(),
                beingNote({ data: { templatePriority: null, portrait: "" } }),
                "",
            ).system.portrait,
        ).toBe("");
    });

    it("leaves `img` alone — it is a top-level fact, and has no `data:` position", () => {
        // The mapping table keeps token art at the note's top level, so the
        // fix must not have quietly moved it too.
        const doc = actors().buildBeing(new Map(), beingNote({ img: "icons/x.svg" }), "");
        expect(doc.img).toBe("systems/sohl/assets/icons/x.svg");
        const inData = actors().buildBeing(
            new Map(),
            beingNote({ data: { templatePriority: null, img: "icons/x.svg" } }),
            "",
        );
        expect(inData.img).toBe(DEFAULT_BEING_ART);
    });
});

describe("an HM3 actor's `system.bioImage`", () => {
    /** HM3 splits a `being` in two, so the note says which. */
    const hm3Being = (extra: Record<string, unknown>) => ({
        ...beingNote(extra),
        hm3: { type: "creature", ...((extra.hm3 as object) ?? {}) },
    });

    it("carries the path authored at `data.portrait`", () => {
        const doc = hm3Actors().buildActor(
            new Map(),
            hm3Being({ data: { templatePriority: null, portrait: "images/beings/akhr.webp" } }),
            "",
        );
        expect(doc.system.bioImage).toBe("systems/sohl/assets/images/beings/akhr.webp");
    });

    it("keeps honouring the legacy top-level `portrait:`", () => {
        const doc = hm3Actors().buildActor(
            new Map(),
            hm3Being({ portrait: "images/being/donkey-portrait.webp" }),
            "",
        );
        expect(doc.system.bioImage).toBe("systems/sohl/assets/images/being/donkey-portrait.webp");
    });

    it("still defaults to the subtype's art when no position names one", () => {
        expect(hm3Actors().buildActor(new Map(), hm3Being({}), "").system.bioImage).toBe(
            "systems/hm3/images/svg/monster-silhouette.svg",
        );
    });
});

/* --------------------------------------------------------------------- */
/*  The lint reads the same positions the compiler does                    */
/* --------------------------------------------------------------------- */

describe('the `""`-means-blank warning sees a portrait under `data:`', () => {
    const lintOptions = { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY } as never;

    const findings = (fm: Record<string, unknown>) =>
        lintNote({ file: "Bestiary/Donkey.md", fm } as never, lintOptions).filter(
            (f: { message: string }) => f.message.includes('`portrait: ""`'),
        );

    it('warns on a top-level `portrait: ""`, as it always did', () => {
        expect(findings({ type: "being", portrait: "" })).toHaveLength(1);
    });

    it('warns on `data.portrait: ""` too, which it could not see before', () => {
        expect(findings({ type: "being", data: { portrait: "" } })).toHaveLength(1);
    });

    it("stays quiet for a portrait that names a path", () => {
        expect(findings({ type: "being", data: { portrait: "images/a.webp" } })).toHaveLength(0);
    });
});
