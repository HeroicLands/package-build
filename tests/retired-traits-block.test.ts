/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `traits:` is a retired frontmatter block (#291, following #128).
 *
 * A being's description — gender, species, age, birthday, height, weight, frame
 * and the `appearance.*` keys — was authored in a top-level `traits:` block.
 * The content format declares no such block: those are the subject's own
 * type-specific facts, so they live in the closed `data:` container, where
 * `being` declares every one of them.
 *
 * The block is *refused* rather than ignored, for the reason `draft:` (#69),
 * `package:` (#56), `aliases:` (#180) and `section:` (#202) are: top level is
 * deliberately open, so a key nothing reads is not ignored loudly there — it is
 * passed straight through to Hugo as a theme parameter. Left in place it would
 * read to its author as though it still worked, with the note saying one thing
 * and the build doing another.
 *
 * Three of the keys reshaped as well as moved, which is why the message states
 * the mapping rather than only the destination.
 *
 * @module
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { assertNoTraitsField, traitsRetiredMessage } from "../engine/retired-fields.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";

describe("`traits:` is a retired frontmatter block (#291)", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retired-traits-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    function write(name: string, frontmatter: string[]): string {
        const file = path.join(tmp, `${name}.md`);
        fs.writeFileSync(file, `---\n${frontmatter.join("\n")}\n---\n\nProse.\n`, "utf8");
        return file;
    }

    it("passes a note that does not declare it", () => {
        expect(() => assertNoTraitsField({ type: "being", shortcode: "clean" })).not.toThrow();
        expect(() => assertNoTraitsField(null)).not.toThrow();
        expect(() => assertNoTraitsField(undefined)).not.toThrow();
    });

    it("passes a note that authored the same facts in `data:`", () => {
        expect(() =>
            assertNoTraitsField({
                type: "being",
                data: { gender: "female", height: 1.78, weight: 65.32, frame: "light" },
            }),
        ).not.toThrow();
    });

    it("refuses the block, whatever it holds", () => {
        // Presence is the whole test, as it is for `draft:` and `aliases:`: an
        // empty `traits:` is still a note claiming a block that no longer exists.
        expect(() => assertNoTraitsField({ type: "being", traits: { gender: "male" } })).toThrow(
            /retired frontmatter block/,
        );
        expect(() => assertNoTraitsField({ type: "being", traits: {} })).toThrow(
            /retired frontmatter block/,
        );
        expect(() => assertNoTraitsField({ type: "being", traits: null })).toThrow(
            /retired frontmatter block/,
        );
    });

    it("does not fire on `sohl.traits`, a different field that shares the name", () => {
        // `projectilegear` declares one inside the system block, and the theme's
        // gear sidebar reads it. Refusing the top-level block must not reach it.
        expect(() =>
            assertNoTraitsField({ type: "projectilegear", sohl: { traits: { barbed: true } } }),
        ).not.toThrow();
    });

    it("locates the offending line at column 1, so a nested key cannot answer for it", () => {
        const file = write("located", [
            "type: being",
            "shortcode: located",
            "sohl:",
            "    traits:",
            "        barbed: true",
            "traits:",
            "    gender: male",
        ]);
        try {
            assertNoTraitsField({ type: "being", traits: { gender: "male" } }, { absPath: file });
            expect.unreachable("should have refused the note");
        } catch (err) {
            expect((err as any).position).toEqual({ line: 7, column: 1 });
        }
    });

    it("says where each key goes, including the three that reshaped", () => {
        const message = traitsRetiredMessage();
        expect(message).toContain("retired");
        expect(message).toContain("data:");
        // The reshaping is the part a plain "write `data:` instead" would lose.
        expect(message).toContain("data.height");
        expect(message).toContain("data.weight");
        expect(message).toContain("data.frame");
        // The path is named only where the caller has no locator of its own.
        expect(traitsRetiredMessage("Characters/Mya.md")).toContain("Characters/Mya.md");
    });

    it("is reported by the frontmatter lint as well as refused at compile", () => {
        const raw = [
            "---",
            "type: being",
            "shortcode: linted",
            "traits:",
            "    gender: male",
            "---",
            "",
            "Prose.",
        ].join("\n");
        const findings = lintNote(
            {
                fm: { type: "being", shortcode: "linted", traits: { gender: "male" } },
                file: "Characters/Linted.md",
                raw,
            } as any,
            { schemas: {} },
        );
        const hits = findings.filter((f: any) => /retired frontmatter block/.test(f.message));
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({
            file: "Characters/Linted.md",
            line: 4,
            column: 1,
            severity: "error",
        });
    });
});
