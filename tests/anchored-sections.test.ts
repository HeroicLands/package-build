/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `{#appearance}` and `{#dossier}` read only an H1. A lower heading carrying
 * one is found by {@link module:engine/anchors.collectAnchors} but not by
 * {@link extractAnchorSection}, which is exactly the gap a silent empty field
 * hides: {@link misplacedAnchorSection} is the check a caller runs first, and
 * `SystemActorCompiler#checkAnchoredSection` is both systems running it.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    extractAnchorSection,
    misplacedAnchorSection,
    renderSection,
} from "../engine/anchored-sections.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";

/** This package's own root — where its test fixtures live. */
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe("extractAnchorSection (an H1 only)", () => {
    it("extracts an H1 section carrying the wanted anchor", () => {
        expect(
            extractAnchorSection("# Appearance {#appearance}\n\nTall and grim.", "appearance"),
        ).toBe("Tall and grim.");
    });

    it("finds nothing for the same anchor on an H2 or an H3", () => {
        expect(
            extractAnchorSection("## Appearance {#appearance}\n\nTall and grim.", "appearance"),
        ).toBe("");
        expect(
            extractAnchorSection("### Appearance {#appearance}\n\nTall and grim.", "appearance"),
        ).toBe("");
    });

    it("runs to the next H1, nested headings included", () => {
        const body = [
            "# Appearance {#appearance}",
            "",
            "Tall.",
            "",
            "## A subheading",
            "",
            "More.",
            "",
            "# Dossier {#dossier}",
            "",
            "Other.",
        ].join("\n");
        expect(extractAnchorSection(body, "appearance")).toBe("Tall.\n\n## A subheading\n\nMore.");
    });
});

describe("misplacedAnchorSection (found, but not on an H1)", () => {
    it("is null when the anchor sits on an H1", () => {
        expect(
            misplacedAnchorSection("# Appearance {#appearance}\n\nTall.", "appearance"),
        ).toBeNull();
    });

    it("is null when the anchor is absent altogether", () => {
        expect(misplacedAnchorSection("# Something else\n\nProse.", "appearance")).toBeNull();
    });

    it("names the line when the anchor sits on an H2", () => {
        const body = "# Being\n\n## Appearance {#appearance}\n\nTall and grim.\n";
        expect(misplacedAnchorSection(body, "appearance")).toEqual({ line: 3 });
    });

    it("offsets by the file's own body line", () => {
        const body = "# Being\n\n## Appearance {#appearance}\n\nTall and grim.\n";
        expect(misplacedAnchorSection(body, "appearance", 5)).toEqual({ line: 7 });
    });

    it("is case-insensitive, like the extractor it guards", () => {
        const body = "## APPEARANCE {#Appearance}\n\nTall.";
        expect(misplacedAnchorSection(body, "appearance")).toEqual({ line: 1 });
    });

    it("renders nothing either way, which is the silence this exists to explain", () => {
        const body = "## Appearance {#appearance}\n\nTall and grim.";
        expect(renderSection(body, "appearance")).toBe("");
        expect(misplacedAnchorSection(body, "appearance")).not.toBeNull();
    });
});

describe("the actor pass reports a misplaced anchor instead of compiling it blank", () => {
    /** A temp items directory, empty, so `prepare()` has somewhere to read. */
    function tempItemsDir() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-anchored-sections-"));
        fs.mkdirSync(path.join(dir, "items"));
        return dir;
    }

    /**
     * Runs `run` against a prepared pass, with every diagnostic captured
     * rather than printed.
     */
    async function withPass(
        Pass: typeof Actors | typeof Hm3Actors,
        run: (pass: any, said: string[]) => void,
    ) {
        const dir = tempItemsDir();
        const said: string[] = [];
        const error = vi
            .spyOn(console, "error")
            .mockImplementation((line: unknown) => void said.push(String(line)));
        try {
            const pass = new Pass({
                skipDirectories: [],
                contentBase: path.join(PKG_ROOT, "tests/fixtures"),
                dest: loadPackConfig().paths.packJson,
                itemsSourceDirs: [path.join(dir, "items")],
            });
            await pass.prepare();
            pass.currentNote = { absPath: "Beings/Thorn.md", bodyLine: 1 };
            run(pass, said);
        } finally {
            error.mockRestore();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    const being = (body: string) =>
        [
            {
                id: "EEEEEEEEEEEEEEEE",
                type: "being",
                shortcode: "thorn",
                name: { full: "Thorn" },
                sohl: { archetype: null },
                hm3: { type: "character" },
            },
            body,
        ] as const;

    it("reports an H2 {#appearance} on the SoHL pass, naming the file and the line", async () => {
        await withPass(Actors, (pass, said) => {
            const [fm, body] = being("# Thorn\n\n## Appearance {#appearance}\n\nTall and grim.\n");
            const doc = pass.buildEntry(fm, body);
            expect(pass.errorCount).toBe(1);
            expect(doc.system.appearance).toBe("");
            const message = said.find((line) => line.includes("Beings/Thorn.md:3"));
            expect(message, said.join("\n")).toBeDefined();
            expect(message).toContain("{#appearance}");
            expect(message).toContain("top level");
        });
    });

    it("reports an H2 {#dossier} on the HM3 pass, naming the file and the line", async () => {
        await withPass(Hm3Actors, (pass, said) => {
            const [fm, body] = being("# Thorn\n\n## Dossier {#dossier}\n\nA fugitive smith.\n");
            const doc = pass.buildEntry(fm, body);
            expect(pass.errorCount).toBe(1);
            expect(doc.system.biography).toBe("");
            const message = said.find((line) => line.includes("Beings/Thorn.md:3"));
            expect(message, said.join("\n")).toBeDefined();
            expect(message).toContain("{#dossier}");
        });
    });

    it("reports nothing for an H1 appearance and dossier, on either pass", async () => {
        await withPass(Actors, (pass) => {
            const [fm, body] = being(
                "# Appearance {#appearance}\n\nTall.\n\n# Dossier {#dossier}\n\nA tale.\n",
            );
            const doc = pass.buildEntry(fm, body);
            expect(pass.errorCount).toBe(0);
            expect(doc.system.appearance).toContain("Tall");
        });
    });
});
