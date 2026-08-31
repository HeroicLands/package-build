/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `draft:` is retired (#69).
 *
 * It excluded a note from the compiled packs, from the link manifest and from a
 * consuming site build, and **no checker reported the consequence**: the link
 * checkers never read the field, so a wikilink into a drafted note was
 * indistinguishable from a link to a note that does not exist. Its entire
 * effect was to move a note from published to unresolvable, in silence.
 *
 * So the readers are gone and the field is **refused**, the same way `package:`
 * is (#56) — a retired field left merely ignored reads to its author as though
 * it still works, which is the same silence in a different place.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { assertNoDraftField, draftRetiredMessage } from "../engine/retired-fields.mjs";

describe("refusing a note that declares `draft:`", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retired-draft-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** A note file whose frontmatter the caller supplies verbatim. */
    function write(name: string, frontmatter: string): string {
        const file = path.join(tmp, `${name}.md`);
        fs.writeFileSync(file, `---\n${frontmatter}\n---\n\nProse.\n`, "utf8");
        return file;
    }

    it("passes anything that does not declare it", () => {
        const file = write(
            "clean",
            ["type: doc", "shortcode: clean", "id: AAAAAAAAAAAAAAAA"].join("\n"),
        );
        expect(() => assertNoDraftField({ type: "doc" }, { absPath: file })).not.toThrow();
        expect(() => assertNoDraftField(null)).not.toThrow();
        expect(() => assertNoDraftField(undefined)).not.toThrow();
    });

    it.each([true, false, "yes", null])(
        "refuses `draft: %s` — presence is the whole test",
        (value) => {
            // The value never mattered, and `draft: false` least of all: it
            // reads as "publish this note", which is what happens either way.
            expect(() => assertNoDraftField({ type: "doc", draft: value })).toThrow(
                /`draft:` is a retired frontmatter field/,
            );
        },
    );

    it("locates the offending line, for a caller that emits a diagnostic", () => {
        const file = write(
            "located",
            ["type: doc", "shortcode: located", "id: BBBBBBBBBBBBBBBB", "draft: true"].join("\n"),
        );
        try {
            assertNoDraftField({ type: "doc", draft: true }, { absPath: file });
            expect.unreachable("should have refused the note");
        } catch (err) {
            // Line 5: the fence opens on line 1, so the block's first line is
            // the file's second. The position rides on the error, so the
            // caller's `file:line:column: error: …` opens on the line that has
            // to be deleted.
            expect((err as any).position).toEqual({ line: 5, column: 1 });
        }
    });

    it("says the field is retired, why, and what to write instead", () => {
        const message = draftRetiredMessage();
        expect(message).toContain("retired");
        // The reason, not just the verdict: the links it silently broke.
        expect(message).toMatch(/wikilink/);
        // The alternative, so the author is not left guessing.
        expect(message).toContain("#draft");
        // The path is named only where the caller has no locator of its own.
        expect(draftRetiredMessage("Gear/Sword.md")).toContain("Gear/Sword.md");
    });

    it("is reported by the frontmatter lint as well as at compile", () => {
        // The lint is where an author meets every finding in the tree at once,
        // rather than one note at a time — the same reason `package:` is
        // reported in both places (#56).
        const raw = [
            "---",
            "type: doc",
            "shortcode: linted",
            "draft: true",
            "---",
            "",
            "Prose.",
        ].join("\n");
        const findings = lintNote(
            {
                fm: { type: "doc", shortcode: "linted", draft: true },
                file: "Rules/Linted.md",
                raw,
            } as any,
            { schemas: {} },
        );
        const draft = findings.filter((f: any) => /`draft:` is a retired/.test(f.message));
        expect(draft).toHaveLength(1);
        expect(draft[0]).toMatchObject({
            file: "Rules/Linted.md",
            line: 4,
            severity: "error",
        });
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

describe("the compile loop refuses a note declaring `draft:`", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retired-draft-pack-"));
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
            const { probe, dest } = await compileOne("drafted", [...NOTE, "draft: true"]);
            // Loud, not silent: the pass counts an error, so the build fails.
            expect(probe.errorCount).toBe(1);
            expect(probe.compiledCount).toBe(0);
            expect(fs.readdirSync(dest)).toHaveLength(0);

            const lines = spy.mock.calls.map((c) => String(c[0]));
            expect(lines).toHaveLength(1);
            // `file:line:column: severity: message`, the path first (#17).
            expect(lines[0]).toMatch(/drafted\.md:7:1: error: /);
            expect(lines[0]).toContain("`draft:` is a retired");
        } finally {
            spy.mockRestore();
        }
    });

    it("is refused whether or not this pass would have claimed the note", async () => {
        // Checked before `selects`, so a `draft:` on a note no pass claims is
        // answered too — otherwise the one arrangement that hid it before
        // would go on hiding it.
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { probe } = await compileOne("unclaimed", [
                "name:",
                "  full: Unclaimed",
                "type: skill",
                "shortcode: unclaimed",
                "id: DDDDDDDDDDDDDDDD",
                "draft: true",
            ]);
            expect(probe.errorCount).toBe(1);
        } finally {
            spy.mockRestore();
        }
    });

    it("compiles the same note once the field is deleted", async () => {
        const { probe, dest } = await compileOne("undrafted", NOTE);
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(1);
        expect(fs.readdirSync(dest)).toHaveLength(1);
    });
});
