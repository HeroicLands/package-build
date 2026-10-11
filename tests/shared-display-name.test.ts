/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Display names are not addresses.
 *
 * Two notes of one type may share a `name.full`, because nothing indexes a
 * note by its display name. `name.aliases` lists alternate names for the note
 * infobox and creates no address; `name-aliases-addresses.test.ts` checks
 * identity.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BasePackCompiler } from "../engine/base-compiler.mjs";

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

describe("the compile loop", () => {
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
        const probe = new Probe({ skipDirectories: [], contentBase: content, dest });
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

    it("compiles a note carrying `name.aliases`", async () => {
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

    it("lets two notes of one type share a display name", async () => {
        // `name.full` is not an index key, so the pair is fine.
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
        const probe = new Probe({ skipDirectories: [], contentBase: content, dest });
        await probe.compile();
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(2);
    });
});
