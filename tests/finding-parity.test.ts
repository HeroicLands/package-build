/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { buildSiteIndex } from "../engine/site-index.mjs";
import { renderSitePage } from "../engine/site-build.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

/**
 * One note body carrying **two** malformed `:::caption` blocks, each missing
 * its required `{#anchor}` attributes. It is the body every surface in this
 * file reads, so a count that differs between them is a real divergence and
 * not a difference in what was asked.
 */
const TWO_CAPTION_PROBLEMS = [
    "Some prose.",
    "",
    ":::caption",
    "First paragraph.",
    ":::",
    "",
    ":::caption",
    "Second paragraph.",
    ":::",
].join("\n");

/**
 * One note body carrying a malformed block **and** an unresolved footnote
 * reference — two unrelated faults, from two different checks, so each
 * surface's count has to be exactly two: one mistake apiece, never a fault
 * counted twice and never one swallowed by the other.
 */
const BLOCK_AND_FOOTNOTE_PROBLEMS = [
    ":::info {size}",
    "Some info.",
    ":::",
    "",
    "A reference with nothing behind it.[^z]",
].join("\n");

/** A minimal pack pass, only so the shared compile loop has one to run. */
class Probe extends BasePackCompiler {
    static override id = "probes";
    static override label = "probe";
    override selects(fm: any): boolean {
        return fm.type === "probe";
    }
    override buildEntry(fm: any, markdown: string): any {
        return { name: fm.name.full, _id: fm.id, body: markdown };
    }
}

/** The note the pack compiler reads, body and frontmatter together. */
function noteFile(body: string): string {
    return [
        "---",
        'name: {"full": "Probe"}',
        'id: "PROBEPROBE000009"',
        'shortcode: "parity"',
        'type: "probe"',
        "---",
        "",
        body,
        "",
    ].join("\n");
}

describe("the pack compiler, the site build and the book agree on one note's findings", () => {
    let spy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
        spy?.mockRestore();
    });

    it("reports both caption findings on every surface, not just the first", async () => {
        // The pack compiler: a tree of one note, compiled, counted.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-finding-parity-"));
        try {
            const content = path.join(tmp, "content");
            fs.mkdirSync(content, { recursive: true });
            fs.writeFileSync(path.join(content, "Probe.md"), noteFile(TWO_CAPTION_PROBLEMS));
            const out = path.join(tmp, "out");
            fs.mkdirSync(out, { recursive: true });
            spy = vi.spyOn(console, "error").mockImplementation(() => {});
            const pack = new Probe({ skipDirectories: [], contentBase: content, dest: out });
            await pack.compile();

            // The site build: one page, rendered.
            const page = {
                kind: "content" as const,
                fm: { type: "doc", shortcode: "parity", name: { full: "Probe" } },
                file: path.join(content, "Probe.md"),
                pkg: "sohl",
                body: TWO_CAPTION_PROBLEMS,
                bodyLine: 8,
                name: "Probe",
                slug: "doc-parity",
                base: "Probe.md",
                relPath: "Probe.md",
            };
            const built = buildSiteIndex([page], { package: "sohl" });
            const site = renderSitePage(page, {
                index: built.index,
                foreign: { index: new Map() },
                universe: new Map(),
                config: {},
            });

            // The book: the same body, through the Typst renderer.
            const findings: { severity: string; message: string }[] = [];
            markdownToTypst(TWO_CAPTION_PROBLEMS, { findings, file: "Probe.md" });

            const captionFindingCount = (list: { message: string }[]) =>
                list.filter((f) => f.message.includes("caption needs {#anchor}")).length;

            expect(pack.errorCount).toBe(2);
            expect(site.captionErrors).toHaveLength(2);
            expect(captionFindingCount(findings)).toBe(2);

            // Not just the same count — the same two complaints, as a set. A
            // surface that worded one of them differently would still pass a
            // bare length check and fail this.
            const asSet = (list: { message: string }[]) => new Set(list.map((f) => f.message));
            expect(asSet(site.captionErrors)).toEqual(
                new Set(["caption needs {#anchor} attributes"]),
            );
            expect(
                asSet(findings.filter((f) => f.message.includes("caption needs {#anchor}"))),
            ).toEqual(new Set(["caption needs {#anchor} attributes"]));
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it("reports a block fault and a footnote fault once each, on every surface", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-finding-parity-"));
        try {
            const content = path.join(tmp, "content");
            fs.mkdirSync(content, { recursive: true });
            fs.writeFileSync(path.join(content, "Probe.md"), noteFile(BLOCK_AND_FOOTNOTE_PROBLEMS));
            const out = path.join(tmp, "out");
            fs.mkdirSync(out, { recursive: true });
            spy = vi.spyOn(console, "error").mockImplementation(() => {});
            const pack = new Probe({ skipDirectories: [], contentBase: content, dest: out });
            await pack.compile();

            const page = {
                kind: "content" as const,
                fm: { type: "doc", shortcode: "parity", name: { full: "Probe" } },
                file: path.join(content, "Probe.md"),
                pkg: "sohl",
                body: BLOCK_AND_FOOTNOTE_PROBLEMS,
                bodyLine: 8,
                name: "Probe",
                slug: "doc-parity",
                base: "Probe.md",
                relPath: "Probe.md",
            };
            const built = buildSiteIndex([page], { package: "sohl" });
            const site = renderSitePage(page, {
                index: built.index,
                foreign: { index: new Map() },
                universe: new Map(),
                config: {},
            });

            const findings: { severity: string; message: string }[] = [];
            markdownToTypst(BLOCK_AND_FOOTNOTE_PROBLEMS, { findings, file: "Probe.md" });

            // One mistake, one finding: the pack compiler's single `errorCount`
            // is the sum of both checks' own arrays on the site build, and the
            // book's two findings match them as a set — never a fault doubled,
            // never one swallowed by the other.
            expect(pack.errorCount).toBe(2);
            expect(site.secretErrors).toHaveLength(1);
            expect(site.footnoteErrors).toHaveLength(1);
            expect(findings).toHaveLength(2);

            const asSet = (list: { message: string }[]) => new Set(list.map((f) => f.message));
            const expected = new Set([
                "size is not a key=value attribute",
                "footnote [^z] has no definition, so it is set as text — write `[^z]: …` " +
                    "at the top level of the note",
            ]);
            expect(asSet([...site.secretErrors, ...site.footnoteErrors])).toEqual(expected);
            expect(asSet(findings)).toEqual(expected);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
