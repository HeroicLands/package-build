/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A map note's background art is `img:`, and `image:` is retired (#142).
 *
 * Every other note type names its artwork `img`, at the note's **top level**,
 * where nothing about it is system-specific. A map alone named it `image` and
 * read it out of the `sohl:` block, so one idea had two spellings and the
 * specification could not state a rule.
 *
 * Retirement here is the `package:` shape (#56) at its **first** step, not its
 * last: both spellings are read, `img` wins, and a note still writing `image`
 * is *reported* rather than refused. That only holds if the two compile to the
 * same document — which is what the first block below asserts, since it is the
 * property the whole retirement window rests on.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildScene, buildLevel } from "../engine/map-notes.mjs";
import { Scenes } from "../engine/scenes.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { readAliasedField, retiredAliasMessage } from "../engine/retired-fields.mjs";

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
        type: "battlemap",
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

describe("`img` and `image` compile to the same Scene (#142)", () => {
    it("is byte-identical whichever spelling the note used", () => {
        const retired = buildSceneDoc(makeNote({}, { image: ART }), makeCtx());
        const current = buildSceneDoc(makeNote({}, { img: ART }), makeCtx());
        // Serialised, not just deep-equal: key *order* is what makes a
        // compiled pack byte-identical, and a reader that appended the field
        // in a new place would pass a structural comparison.
        expect(JSON.stringify(current)).toBe(JSON.stringify(retired));
        expect(current.levels[0].background.src).toBe(ART);
    });

    it("reads `img` from the note's top level, where every other type carries it", () => {
        const inBlock = buildSceneDoc(makeNote({}, { img: ART }), makeCtx());
        const topLevel = buildSceneDoc(makeNote({ img: ART }, {}), makeCtx());
        expect(JSON.stringify(topLevel)).toBe(JSON.stringify(inBlock));
    });

    it("lets `img` win when a note carries both", () => {
        const scene = buildSceneDoc(
            makeNote({}, { img: ART, image: "systems/sohl/assets/ui/old.jpg" }),
            makeCtx(),
        );
        expect(scene.levels[0].background.src).toBe(ART);
    });

    it("still refuses a map note that names no art at all", () => {
        expect(() => buildSceneDoc(makeNote(), makeCtx())).toThrow(/needs an `img`/);
    });

    it("synthesises the Level from either spelling", () => {
        expect(buildLevelDoc({ image: ART }, SCENE_ID).background.src).toBe(ART);
        expect(buildLevelDoc({ img: ART }, SCENE_ID).background.src).toBe(ART);
    });

    it("reads the current name first and falls back to the retired one", () => {
        expect(readAliasedField({ sohl: { img: ART } }, "img")).toBe(ART);
        expect(readAliasedField({ sohl: { image: ART } }, "img")).toBe(ART);
        expect(readAliasedField({ img: ART }, "img")).toBe(ART);
        expect(readAliasedField({ sohl: {} }, "img")).toBeUndefined();
    });
});

describe("the scenes pass reports the retired spelling (#142)", () => {
    let tmp: string;
    let warnings: string[];

    const NOTE = `---
name:
  full: Retired Spelling
id: BBBBBBBBBBBBBBBB
shortcode: retiredspelling
type: battlemap
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

        warnings = [];
        // `emitDiagnostic` writes both severities through `console.warn` /
        // `console.error`; a warning is the former.
        const spy = vi.spyOn(console, "warn").mockImplementation((line: any) => {
            warnings.push(String(line));
        });
        const pack = new Scenes({
            contentBase: content,
            dest,
            companionDests: { adventures },
        });
        await pack.compile();
        spy.mockRestore();
        expect(pack.errorCount).toBe(0);
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it("compiles the note, and says the field is retired", () => {
        const finding = warnings.find((w) => w.includes("`image:`"));
        expect(finding, warnings.join("\n")).toBeDefined();
        expect(finding).toContain("`img:`");
    });

    it("opens on the offending line, path first", () => {
        const finding = warnings.find((w) => w.includes("`image:`")) ?? "";
        // `path:line:column: severity: message` — the note's own file, and the
        // line the field is declared on (line 8: the fence opens on line 1).
        expect(finding).toMatch(/^\S*Retired\.md:8:3: warning: /);
    });
});

describe("the frontmatter lint reports it too (#142)", () => {
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
            type: "battlemap",
            raw: `---\ntype: battlemap\n${top ? `${top}\n` : ""}sohl:\n${block}\n---\n`,
            fm: { type: "battlemap", ...fm, sohl },
        };
    };

    const lint = (note: ReturnType<typeof mapNote>) =>
        lintNote(note as any, { schemas: NOTE_SCHEMAS as any });

    const complete = { dimensions: [512, 512], pxPerGrid: 64 };

    it("reports `image` as retired, naming the replacement, as a warning", () => {
        const findings = lint(mapNote({}, { ...complete, image: ART }));
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("warning");
        expect(findings[0].message).toContain("`image:`");
        expect(findings[0].message).toContain("`img:`");
        // Located on the field, not on `type:` — the line that has to change.
        expect(findings[0].line).toBe(6);
    });

    it("does not also report the required `img` as missing", () => {
        const findings = lint(mapNote({}, { ...complete, image: ART }));
        expect(findings.map((f) => f.message).join("\n")).not.toContain("must declare");
    });

    it("does not offer a did-you-mean — it is retired, not unknown", () => {
        const findings = lint(mapNote({}, { ...complete, image: ART }));
        expect(findings.map((f) => f.message).join("\n")).not.toContain("Did you mean");
        expect(findings.map((f) => f.message).join("\n")).not.toContain("is discarded at compile");
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

    it("says what to write instead rather than which value to correct", () => {
        // The same rule the `draft:` and `package:` messages follow: no value
        // makes the retired spelling right, so the message names the key.
        const message = retiredAliasMessage("image", "img");
        expect(message).toContain("`image:`");
        expect(message).toContain("`img:`");
        expect(message).not.toMatch(/[.!]$/);
    });
});
