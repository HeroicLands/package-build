/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The top-level `aliases:` is retired (#180).
 *
 * It fed one reader — the alias index the bare `[[Alias]]` form looked up in —
 * and that form resolved to nothing anywhere in the corpus. What the index did
 * do was fold `name.full` in beside it, which made two notes of one type
 * forbidden from sharing a display name (#179).
 *
 * So the reader is gone and the field is **refused**, the same way `draft:`
 * (#69) and `package:` (#56) are: a retired field left merely ignored reads to
 * its author as though it still works.
 *
 * **`name.aliases` is not this field.** It fed the same index and lost the same
 * reader, but it is *reserved* rather than retired, so it is neither refused
 * nor read. The cases below pin that it survives every refusal this file is
 * about; `name-aliases-reserved.test.ts` pins that nothing reads it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { aliasesRetiredMessage, assertNoAliasesField } from "../engine/retired-fields.mjs";
import { NOTE_LEVEL_KEYS } from "../engine/content-format-check.mjs";

describe("refusing a note that declares `aliases:`", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retired-aliases-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** A note file whose frontmatter the caller supplies verbatim. */
    function write(name: string, frontmatter: string): string {
        const file = path.join(tmp, `${name}.md`);
        fs.writeFileSync(file, `---\n${frontmatter}\n---\n\nProse.\n`, "utf8");
        return file;
    }

    it("passes anything that declares neither spelling", () => {
        const file = write(
            "clean",
            ["type: doc", "shortcode: clean", "id: AAAAAAAAAAAAAAAA"].join("\n"),
        );
        expect(() =>
            assertNoAliasesField({ type: "doc", name: { full: "Clean" } }, { absPath: file }),
        ).not.toThrow();
        expect(() => assertNoAliasesField(null)).not.toThrow();
        expect(() => assertNoAliasesField(undefined)).not.toThrow();
    });

    it("refuses the top-level `aliases`", () => {
        expect(() => assertNoAliasesField({ type: "doc", aliases: ["Wolfsbane"] })).toThrow(
            /retired frontmatter field/,
        );
    });

    it("permits `name.aliases`, which is reserved rather than retired", () => {
        // The one field this refusal must not reach. Populated, empty, and
        // alongside the retired sibling — the nested list never provokes it.
        expect(() =>
            assertNoAliasesField({
                type: "doc",
                name: { full: "Aconite", aliases: ["Wolfsbane"] },
            }),
        ).not.toThrow();
        expect(() =>
            assertNoAliasesField({ type: "doc", name: { full: "Aconite", aliases: [] } }),
        ).not.toThrow();
    });

    it("refuses an empty list too — presence is the whole test", () => {
        // `aliases: []` reads as "this note claims no other names", which is a
        // statement about a namespace that no longer exists.
        expect(() => assertNoAliasesField({ type: "doc", aliases: [] })).toThrow(
            /retired frontmatter field/,
        );
    });

    it("locates the offending line, for a caller that emits a diagnostic", () => {
        const file = write(
            "located",
            [
                "type: doc",
                "shortcode: located",
                "id: BBBBBBBBBBBBBBBB",
                "aliases:",
                "  - Wolfsbane",
            ].join("\n"),
        );
        try {
            assertNoAliasesField({ type: "doc", aliases: ["Wolfsbane"] }, { absPath: file });
            expect.unreachable("should have refused the note");
        } catch (err) {
            expect((err as any).position).toEqual({ line: 5, column: 1 });
        }
    });

    it("says the field is retired, why, and what to write instead", () => {
        const message = aliasesRetiredMessage();
        expect(message).toContain("retired");
        // The reason: the form it served no longer resolves anything.
        expect(message).toMatch(/\[\[/);
        // The alternative, so the author is not left guessing.
        expect(message).toContain("[[type-shortcode|Text]]");
        // The path is named only where the caller has no locator of its own.
        expect(aliasesRetiredMessage("Gear/Sword.md")).toContain("Gear/Sword.md");
    });

    it("never tells an author to delete `name.aliases`", () => {
        // The message is the whole author-facing surface of the refusal, and
        // naming a permitted field in it would read as a rule against it.
        expect(aliasesRetiredMessage()).not.toContain("name.aliases");
    });

    it("locates the top-level field, never a `name.aliases` above it", () => {
        // Both spellings write the key `aliases`; the locator is anchored at
        // column 1 so a finding about the retired one cannot open on the
        // permitted one, even when the permitted one comes first.
        const file = write(
            "both",
            [
                "name:",
                "  full: Aconite",
                "  aliases:",
                "    - Wolfsbane",
                "type: doc",
                "shortcode: both",
                "aliases:",
                "  - Monkshood",
            ].join("\n"),
        );
        try {
            assertNoAliasesField({ type: "doc", aliases: ["Monkshood"] }, { absPath: file });
            expect.unreachable("should have refused the note");
        } catch (err) {
            // Line 8 is the top-level `aliases:`; line 4 is the nested one.
            expect((err as any).position).toEqual({ line: 8, column: 1 });
        }
    });

    it("is reported by the frontmatter lint as well as at compile", () => {
        const raw = [
            "---",
            "type: doc",
            "shortcode: linted",
            "aliases:",
            "  - Wolfsbane",
            "---",
            "",
            "Prose.",
        ].join("\n");
        const findings = lintNote(
            {
                fm: { type: "doc", shortcode: "linted", aliases: ["Wolfsbane"] },
                file: "Rules/Linted.md",
                raw,
            } as any,
            { schemas: {} },
        );
        const hits = findings.filter((f: any) => /retired frontmatter field/.test(f.message));
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({
            file: "Rules/Linted.md",
            line: 4,
            severity: "error",
        });
    });

    it("is no longer one of the note-level keys the format names", () => {
        expect(NOTE_LEVEL_KEYS.has("aliases")).toBe(false);
    });
});

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

describe("the compile loop refuses a note declaring `aliases:`", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retired-aliases-pack-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** A one-note tree, and the pass that compiled it. */
    async function compileOne(
        name: string,
        frontmatter: string[],
    ): Promise<{ probe: Probe; dest: string }> {
        const content = path.join(tmp, name, "content");
        const dest = path.join(tmp, name, "out");
        fs.mkdirSync(content, { recursive: true });
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(
            path.join(content, `${name}.md`),
            ["---", ...frontmatter, "---", "", "Prose.", ""].join("\n"),
            "utf8",
        );
        const probe = new Probe({ contentBase: content, dest });
        await probe.compile();
        return { probe, dest };
    }

    const NOTE = [
        "name:",
        "  full: A Note",
        "type: doc",
        "shortcode: anote",
        "id: CCCCCCCCCCCCCCCC",
    ];

    it("counts it as an error, writes no document, and names the line", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { probe, dest } = await compileOne("aliased", [
                ...NOTE,
                "aliases:",
                "  - Another Name",
            ]);
            expect(probe.errorCount).toBe(1);
            expect(probe.compiledCount).toBe(0);
            expect(fs.readdirSync(dest)).toHaveLength(0);

            const lines = spy.mock.calls.map((c) => String(c[0]));
            expect(lines).toHaveLength(1);
            // `file:line:column: severity: message`, the path first (#17).
            expect(lines[0]).toMatch(/aliased\.md:7:1: error: /);
            expect(lines[0]).toContain("retired frontmatter field");
        } finally {
            spy.mockRestore();
        }
    });

    it("compiles a note carrying the reserved `name.aliases`", async () => {
        const { probe, dest } = await compileOne("nested", [
            "name:",
            "  full: Nested",
            "  aliases:",
            "    - Another Name",
            "type: doc",
            "shortcode: nested",
            "id: DDDDDDDDDDDDDDDD",
        ]);
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(1);
        expect(fs.readdirSync(dest)).toHaveLength(1);
    });

    it("compiles the same note once the field is deleted", async () => {
        const { probe, dest } = await compileOne("unaliased", NOTE);
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(1);
        expect(fs.readdirSync(dest)).toHaveLength(1);
    });

    it("lets two notes of one type share a display name (#179)", async () => {
        // The alias index folded `name.full` into the namespace, so this pair
        // was a build failure and every fix moved a published URL. With the
        // index gone, `name.full` is not an index key and the pair is fine.
        const content = path.join(tmp, "twins", "content");
        const dest = path.join(tmp, "twins", "out");
        fs.mkdirSync(content, { recursive: true });
        fs.mkdirSync(dest, { recursive: true });
        for (const [file, code] of [
            ["Rules_Gear.md", "rgear"],
            ["Guide_Gear.md", "ggear"],
        ]) {
            fs.writeFileSync(
                path.join(content, file),
                [
                    "---",
                    "name:",
                    "  full: Gear",
                    "type: doc",
                    `shortcode: ${code}`,
                    `id: ${code.toUpperCase().padEnd(16, "X")}`,
                    "---",
                    "",
                    "Prose.",
                    "",
                ].join("\n"),
                "utf8",
            );
        }
        const probe = new Probe({ contentBase: content, dest });
        await probe.compile();
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(2);
    });
});
