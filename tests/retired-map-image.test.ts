/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A map note's background art is `img:`, and `image:` is gone (#149).
 *
 * Every other note type names its artwork `img`, at the note's **top level**,
 * where nothing about it is system-specific. A map alone named it `image` and
 * read it out of the `sohl:` block, so one idea had two spellings and the
 * specification could not state a rule.
 *
 * That rename runs the three steps `package:` took. The first —
 * both spellings read, `img` winning, `image` reported rather than refused. The
 * sweep took the second, leaving no tree writing it. This is the **third**: the
 * alias is dropped, and `image` is an ordinary unknown key again.
 *
 * The point of the third step is that it needs no refusal of its own. The two
 * findings an unswept note already earns — the unknown key, and the required
 * `img` it therefore failed to supply — are the refusal, so what these tests
 * pin is that both arrive and that the note stops compiling. A retirement whose
 * last step had to *add* a check would be one whose replacement never landed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildScene, buildLevel } from "../engine/map-notes.mjs";
import { Scenes } from "../engine/scenes.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { RETIRED_FIELD_ALIASES, readAliasedField } from "../engine/retired-fields.mjs";

const SCENE_ID = "AAAAAAAAAAAAAAAA";
const ART = "systems/sohl/assets/ui/parchment.jpg";

// The pack helpers are plain ESM whose JSDoc types the returns as `object`, so
// these thin wrappers keep the assertions below readable.
const buildSceneDoc = (fm: unknown, ctx: unknown): any => buildScene(fm as any, ctx as any);
const buildLevelDoc = (...args: unknown[]): any => (buildLevel as any)(...args);

/** A minimal, valid map note, whose art the caller places where it likes. */
function makeNote(fm: Record<string, unknown> = {}, sohl: Record<string, unknown> = {}) {
    return {
        name: { full: "Ambush at the Defile" },
        id: SCENE_ID,
        shortcode: "ambushdefile",
        type: "map",
        subType: "battlemap",
        ...fm,
        sohl: {
            dimensions: [1900, 2600],
            pxPerGrid: 100,
            ...sohl,
        },
    };
}

/** The context a compiled scene needs from the surrounding passes. */
function makeCtx() {
    return {
        packageId: "sohl",
        pageIds: new Map(),
        resolveRegionRef: () => "",
        resolveBehaviorRef: () => "",
        resolveEffectRef: () => "",
        knownActions: new Set<string>(),
        warnings: [] as string[],
    };
}

describe("the alias is gone", () => {
    it("no longer maps `img` onto a retired spelling", () => {
        expect(RETIRED_FIELD_ALIASES).not.toHaveProperty("img");
    });

    it("leaves a field with no alias reading only its own name", () => {
        // `readAliasedField` is still the generic reader for the entries that
        // remain; asked for one that has none, it must not invent a fallback.
        expect(readAliasedField({ sohl: { img: ART } }, "img")).toBe(ART);
        expect(readAliasedField({ img: ART }, "img")).toBe(ART);
        expect(readAliasedField({ sohl: { image: ART } }, "img")).toBeUndefined();
    });
});

describe("`img` is read wherever a swept note put it", () => {
    it("reads it from the note's top level, where every other type carries it", () => {
        const topLevel = buildSceneDoc(makeNote({ img: ART }, {}), makeCtx());
        expect(topLevel.levels[0].background.src).toBe(ART);
    });

    it("still honours a note that has not moved it out of the block", () => {
        // Position is not enforced — `sohlField` reads the block first for
        // every field on every type — so the sweep is a content change, not a
        // flag day. Serialised, not just deep-equal: key *order* is what makes
        // a compiled pack byte-identical, and a reader that appended the field
        // in a new place would pass a structural comparison.
        const inBlock = buildSceneDoc(makeNote({}, { img: ART }), makeCtx());
        const topLevel = buildSceneDoc(makeNote({ img: ART }, {}), makeCtx());
        expect(JSON.stringify(topLevel)).toBe(JSON.stringify(inBlock));
    });

    it("refuses a map note that names no art at all", () => {
        expect(() => buildSceneDoc(makeNote(), makeCtx())).toThrow(/needs an `img`/);
    });

    it("refuses one that names it with the retired spelling", () => {
        expect(() => buildSceneDoc(makeNote({}, { image: ART }), makeCtx())).toThrow(
            /needs an `img`/,
        );
    });

    it("synthesises the Level from `img`, and from nothing else", () => {
        expect(buildLevelDoc({ img: ART }, SCENE_ID).background.src).toBe(ART);
        expect(buildLevelDoc({ image: ART }, SCENE_ID).background.src).toBeUndefined();
    });
});

describe("the scenes pass refuses the retired spelling", () => {
    let tmp: string;
    let errors: string[];
    let errorCount: number;

    const NOTE = `---
name:
  full: Retired Spelling
id: BBBBBBBBBBBBBBBB
shortcode: retiredspelling
type: map
subType: battlemap
sohl:
  image: ${ART}
  dimensions: [512, 512]
  pxPerGrid: 64
---

Prose.
`;

    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retired-map-image-"));
        const content = path.join(tmp, "content");
        const dest = path.join(tmp, "scenes");
        const adventures = path.join(tmp, "adventures");
        fs.mkdirSync(content, { recursive: true });
        fs.mkdirSync(dest);
        fs.mkdirSync(adventures);
        fs.writeFileSync(path.join(content, "Retired.md"), NOTE);

        errors = [];
        // `emitDiagnostic` writes both severities through `console.warn` /
        // `console.error`; an error is the latter.
        const spy = vi.spyOn(console, "error").mockImplementation((line: any) => {
            errors.push(String(line));
        });
        const pack = new Scenes({
            skipDirectories: [],
            contentBase: content,
            dest,
            companionDests: { adventures },
        });
        await pack.compile();
        spy.mockRestore();
        errorCount = pack.errorCount;
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it("fails the build rather than compiling the note", () => {
        expect(errorCount).toBe(1);
    });

    it("says the note has no `img`, naming its file", () => {
        const finding = errors.find((e) => e.includes("needs an `img`"));
        expect(finding, errors.join("\n")).toBeDefined();
        expect(finding).toMatch(/^\S*Retired\.md: error: /);
    });

    it("does not still describe the spelling as read", () => {
        // The retirement-window message said the note compiled either way.
        // Surviving into the third step, it would contradict the refusal.
        expect(errors.join("\n")).not.toContain("Both are read");
    });
});

describe("the frontmatter lint refuses it too", () => {
    /** A map note as the link index hands one over. */
    const mapNote = (fm: Record<string, unknown>, sohl: Record<string, unknown>) => {
        const block = Object.entries(sohl)
            .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
            .join("\n");
        const top = Object.entries(fm)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join("\n");
        return {
            file: "/tree/Map.md",
            type: "map",
            subType: "battlemap",
            raw: `---\ntype: map\nsubType: battlemap\n${top ? `${top}\n` : ""}sohl:\n${block}\n---\n`,
            fm: { type: "map", subType: "battlemap", ...fm, sohl },
        };
    };

    const lint = (note: ReturnType<typeof mapNote>) =>
        lintNote(note as any, { schemas: NOTE_SCHEMAS as any });

    const complete = { dimensions: [512, 512], pxPerGrid: 64 };

    it("reports `image` in the block as a key the type does not have", () => {
        const findings = lint(mapNote({}, { ...complete, image: ART }));
        const unknown = findings.find((f) => f.message.includes('"image"'));
        expect(unknown, JSON.stringify(findings)).toBeDefined();
        expect(unknown!.severity).toBe("error");
        // Located on the field, not on `type:` — the line that has to change.
        expect(unknown!.line).toBe(7);
    });

    it("also reports the `img` the note therefore never supplied", () => {
        const findings = lint(mapNote({}, { ...complete, image: ART }));
        const missing = findings.find((f) => f.message.includes("must declare `img`"));
        expect(missing, JSON.stringify(findings)).toBeDefined();
        expect(missing!.severity).toBe("error");
    });

    it("no longer calls it retired, or says the note compiles anyway", () => {
        const text = lint(mapNote({}, { ...complete, image: ART }))
            .map((f) => f.message)
            .join("\n");
        expect(text).not.toContain("retired frontmatter field");
        expect(text).not.toContain("Both are read");
    });

    it("refuses a note that moved the spelling to the top level without renaming it", () => {
        // Top level is deliberately open — an unrecognised key there passes
        // through to Hugo — so the stray `image` is not itself reported. The
        // missing `img` is, which is what stops the note.
        const findings = lint(mapNote({ image: ART }, complete));
        expect(findings.map((f) => f.message).join("\n")).toContain("must declare `img`");
    });

    it("passes a note that writes `img` at the top level", () => {
        expect(lint(mapNote({ img: ART }, complete))).toEqual([]);
    });

    it("passes a note that writes `img` inside the block", () => {
        expect(lint(mapNote({}, { ...complete, img: ART }))).toEqual([]);
    });

    it("still reports a map note that names no art at all", () => {
        const findings = lint(mapNote({}, complete));
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain("`img`");
    });
});
