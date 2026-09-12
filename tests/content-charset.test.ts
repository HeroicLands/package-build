/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The charset authored content is held to (#377).
 *
 * The cases below are grouped by the argument each tier rests on, because the
 * tiers are not a matter of taste: they were drawn by probing eight candidate
 * book faces over the corpus. So the tests assert the *consequences* that
 * measurement had — punctuation is admitted because every face carries it, IPA
 * is refused although it looks scholarly because three faces do not.
 *
 * Deliberately not covered here: which font a renderer ultimately picks, and
 * whether Typst embeds it. That is the renderer's subject; this module's is
 * what a note is allowed to contain.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    checkText,
    decomposedRuns,
    isAllowedCodePoint,
    isDiagramCodePoint,
    lintContentCharset,
    NOTATION,
    TYPOGRAPHY,
} from "../engine/content-charset.mjs";

/** Messages joined, for the cases that care what was said rather than where. */
const said = (findings: Array<{ message: string }>) => findings.map((f) => f.message).join("\n");

describe("the letter tiers", () => {
    it("admits the accented names the corpus is built from", () => {
        for (const ch of "áéâāíëüóûîúōÁêèôàÉöĀäýšēīÍÓìūśòñÂşæŷçãõĩũÝ") {
            expect(isAllowedCodePoint(ch.codePointAt(0)!), ch).toBe(true);
        }
    });

    it("admits the dot-under transliteration, which seven of eight faces carry", () => {
        for (const ch of "ṇṣṅṭḥṛḍṁḫḳẓṉạộ") {
            expect(isAllowedCodePoint(ch.codePointAt(0)!), ch).toBe(true);
        }
    });

    it("admits thorn, eth, eszett and the ligatures, though the corpus has none today", () => {
        // Absent now; the charset should not have to change when a Norse-flavoured
        // region arrives, because these are ordinary Latin letters.
        for (const ch of "þÞðÐßæÆœŒøØåÅŋŊ") {
            expect(isAllowedCodePoint(ch.codePointAt(0)!), ch).toBe(true);
        }
    });

    it("does not admit × and ÷ as letters, though they sit inside the Latin-1 block", () => {
        // They are allowed, but by Tier 3 and on their own merits.
        expect(NOTATION.has(0x00d7)).toBe(true);
        expect(NOTATION.has(0x00f7)).toBe(true);
    });
});

describe("typography", () => {
    it("admits the em dash, which is the single most common non-ASCII character", () => {
        expect(isAllowedCodePoint(0x2014)).toBe(true);
    });

    it("admits the ten enumerated marks and no more of the block", () => {
        expect(TYPOGRAPHY.size).toBe(10);
    });

    it("refuses the invisible characters that share the block with them", () => {
        // The reason the block is enumerated rather than admitted wholesale.
        for (const cp of [0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060]) {
            expect(isAllowedCodePoint(cp), cp.toString(16)).toBe(false);
        }
    });

    it("refuses a no-break space and a soft hyphen by name", () => {
        const findings = checkText("a b­c", "n.md");
        expect(said(findings)).toContain("no-break space");
        expect(said(findings)).toContain("soft hyphen");
    });
});

describe("what the measurement excluded", () => {
    it("refuses IPA, and says to describe the sound instead", () => {
        const findings = checkText("the vowel /ə/ is common", "n.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("U+0259");
        expect(findings[0].message).toContain("describe the sound");
    });

    it("refuses tone letters", () => {
        expect(said(checkText("High Tone (˥)", "n.md"))).toContain("tone letter");
    });

    it("refuses the Egyptological alef", () => {
        expect(said(checkText("_mḫꜣt_", "n.md"))).toContain("U+A723");
    });

    it("refuses emoji and points at the icon role", () => {
        expect(said(checkText("the 🗑 button", "n.md"))).toContain("icon role");
    });

    it("refuses a dingbat, because no candidate face carries one", () => {
        expect(said(checkText("an ✕ here", "n.md"))).toContain("icon role");
    });

    it("refuses a fullwidth form and asks for the ASCII character", () => {
        expect(said(checkText("the ＋ control", "n.md"))).toContain("write the ASCII");
    });

    it("refuses an arrow and names the replacement", () => {
        expect(said(checkText("Modules → Install", "n.md"))).toContain("`>`");
    });
});

describe("the fence rule", () => {
    it("admits box drawing inside a fenced block", () => {
        const text = ["```", "a ━━━ b", "│ c │", "```"].join("\n");
        expect(checkText(text, "n.md")).toEqual([]);
    });

    it("refuses the same characters in prose", () => {
        expect(checkText("a ━ b", "n.md")).toHaveLength(1);
    });

    it("still refuses an emoji inside a fence, which no mono face rescues", () => {
        const text = ["```", "🗑", "```"].join("\n");
        expect(checkText(text, "n.md")).toHaveLength(1);
    });

    it("closes the fence again, so prose after it is checked", () => {
        const text = ["```", "━", "```", "and ━ here"].join("\n");
        const findings = checkText(text, "n.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].line).toBe(4);
    });

    it("treats a tilde fence the same as a backtick fence", () => {
        expect(checkText(["~~~", "━", "~~~"].join("\n"), "n.md")).toEqual([]);
    });

    it("only allows the diagram ranges there, not everything", () => {
        expect(isDiagramCodePoint(0x2501)).toBe(true);
        expect(isDiagramCodePoint(0x25c6)).toBe(true);
        expect(isDiagramCodePoint(0x2192)).toBe(true);
        expect(isDiagramCodePoint(0x0259)).toBe(false);
    });
});

describe("normalization", () => {
    const NFD = "Fývria";
    const NFC = "Fývria";

    it("reports a decomposed letter as one run, not as a stray accent", () => {
        const runs = decomposedRuns(NFD);
        expect(runs).toHaveLength(1);
        expect(runs[0].sequence).toBe("ý");
        expect(runs[0].composed).toBe("ý");
    });

    it("says both spellings and why it matters", () => {
        const message = said(checkText(`full: ${NFD}`, "n.md"));
        expect(message).toContain("U+0079 U+0301");
        expect(message).toContain("U+00FD");
        expect(message).toContain("exact-match filter");
    });

    it("passes the precomposed spelling", () => {
        expect(checkText(`full: ${NFC}`, "n.md")).toEqual([]);
    });

    it("does not report a letter that has no precomposed form", () => {
        // An underdot on a q composes to nothing, so the decomposed spelling is
        // the only spelling and reporting it would be asking for the impossible.
        const runs = decomposedRuns("q̣");
        expect(runs).toEqual([]);
    });

    it("reports a decomposed letter once, not twice", () => {
        // The combining mark is refused by the charset and the run is refused by
        // the normalization rule. They are one mistake, and two findings would
        // offer two different fixes for one edit.
        const findings = checkText(`full: ${NFD}`, "n.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("precomposed");
    });

    it("still refuses a combining mark that composes to nothing", () => {
        // No precomposed form exists, so no run covers it and the charset owns it.
        const findings = checkText("q̣", "n.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("combining mark");
    });

    it("locates the run on its own line", () => {
        const findings = checkText(`---\nname:\n  full: ${NFD}\n---\n`, "n.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].line).toBe(3);
    });
});

describe("reporting", () => {
    it("reports one finding per character per line, not one per occurrence", () => {
        // Sixty box-drawing cells are one mistake made once.
        expect(checkText("━".repeat(60), "n.md")).toHaveLength(1);
    });

    it("still reports two different characters on one line", () => {
        expect(checkText("━ and ✕", "n.md")).toHaveLength(2);
    });

    it("orders findings by position", () => {
        const findings = checkText("ok\n✕ here\n━ there", "n.md");
        expect(findings.map((f) => f.line)).toEqual([2, 3]);
    });

    it("passes a clean note", () => {
        const text = "# Hârn — a note\n\nIt costs £9,400, or ½ a measure, at ≥ 10 “each”.\n";
        expect(checkText(text, "n.md")).toEqual([]);
    });
});

describe("walking a tree", () => {
    const write = (root: string, rel: string, body: string) => {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
    };

    it("reads the tree and skips dot-directories", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "charset-"));
        write(root, "Skills/Clean.md", "A clean note — nothing to say.\n");
        write(root, "Skills/Dirty.md", "the vowel /ə/\n");
        // Editor state, not prose. Its CRLF endings are not this tree's problem.
        write(root, ".obsidian/plugins/x/manifest.json", '{"a":1}\r\n');

        const { findings, files } = lintContentCharset(root);
        expect(files).toBe(2);
        expect(findings).toHaveLength(1);
        expect(findings[0].file).toBe(path.join("Skills", "Dirty.md"));
    });

    it("honours skipDirectories as well", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "charset-"));
        write(root, "keep/A.md", "fine\n");
        write(root, "build/B.md", "the vowel /ə/\n");
        const { findings, files } = lintContentCharset(root, { skipDirectories: ["build"] });
        expect(files).toBe(1);
        expect(findings).toEqual([]);
    });

    it("reports and does not throw on a tree it cannot read", () => {
        const { findings, files } = lintContentCharset(path.join(os.tmpdir(), "no-such-tree-377"));
        expect(files).toBe(0);
        expect(findings).toEqual([]);
    });
});
