/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The middle state of `age`: absent beside a dated `born`, it follows from the
 * date — and every surface that compiles `data:` carries the value, with the
 * note on disk untouched.
 *
 * Three layers, matching the three places a being's `age` reaches a reader:
 * the pure arithmetic ({@link computeAge}, {@link parseAgeMagnitude}), the
 * lint's disagreement warning ({@link checkBeingAge}, through `lintNote`), and
 * the compiled surfaces themselves — the content index and a compiled
 * JournalEntry's infobox — proven end to end against a real fixture tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    applyComputedBeingAge,
    checkBeingAge,
    computeAge,
    parseAgeMagnitude,
    presentAmongFrontmatters,
    presentAmongRecords,
} from "../engine/being-age.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { collectContentIndex } from "../engine/content-index.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/** A note as the link index hands one over: parsed frontmatter beside its text. */
function note(fm: Record<string, unknown>, file = "Being.md") {
    const lines: string[] = [];
    const emit = (obj: Record<string, unknown>, indent: string) => {
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                lines.push(`${indent}${key}:`);
                emit(value as Record<string, unknown>, `${indent}    `);
            } else {
                lines.push(`${indent}${key}: ${JSON.stringify(value)}`);
            }
        }
    };
    emit(fm, "");
    const raw = `---\n${lines.join("\n")}\n---\n\nProse.\n`;
    return { file, rel: file, fm, raw, body: "Prose.", type: String(fm.type ?? "") };
}

/** A `place` note stating the world's year and present, the way `worldInvariants` reads it. */
function worldNote(present: unknown, days = 360) {
    return note(
        {
            type: "place",
            subType: "world",
            shortcode: "world",
            name: { full: "The World" },
            data: { year: { days }, present },
        },
        "World.md",
    );
}

/** A being note declaring `born` and, optionally, `age`. */
function beingNote(data: Record<string, unknown>, file = "Being.md") {
    return note({ type: "being", shortcode: "being", name: { full: "A Being" }, data }, file);
}

const lintOpts = { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY };

describe("computeAge", () => {
    it("computes from two dates, not from two years", () => {
        // A twelve-month, thirty-day calendar — `born`'s birthday (month 12)
        // falls later in the year than `present`'s (month 1), so the age is one
        // lower than plain year subtraction (720 - 676 = 44) gives.
        expect(computeAge("676/12/5", "720/1/1")).toBe(43);
    });

    it("gives plain year subtraction when the birthday has already passed", () => {
        expect(computeAge("676/1/1", "720/6/1")).toBe(44);
    });

    it("gives plain year subtraction on the birthday itself", () => {
        expect(computeAge("676/1/1", "720/1/1")).toBe(44);
    });

    it("is null beside `born: unknown`", () => {
        expect(computeAge("unknown", "720/1/1")).toBeNull();
    });

    it("is null beside an absent `born`", () => {
        expect(computeAge(undefined, "720/1/1")).toBeNull();
        expect(computeAge(null, "720/1/1")).toBeNull();
    });

    it("is null when no present is declared", () => {
        expect(computeAge("676/12/5", undefined)).toBeNull();
        expect(computeAge("676/12/5", null)).toBeNull();
    });
});

describe("parseAgeMagnitude", () => {
    it("reads a plain number", () => {
        expect(parseAgeMagnitude(34)).toEqual({ approximate: false, value: 34 });
        expect(parseAgeMagnitude("34")).toEqual({ approximate: false, value: 34 });
    });

    it("reads the `~` estimate mark, keeping the magnitude", () => {
        expect(parseAgeMagnitude("~34")).toEqual({ approximate: true, value: 34 });
    });

    it("refuses age 0 no special-case — it is a plain magnitude", () => {
        expect(parseAgeMagnitude(0)).toEqual({ approximate: false, value: 0 });
    });

    it("is null for anything that is not a plain count of years", () => {
        expect(parseAgeMagnitude("unknown")).toBeNull();
        expect(parseAgeMagnitude("thirty-four")).toBeNull();
        expect(parseAgeMagnitude(undefined)).toBeNull();
    });
});

describe("applyComputedBeingAge", () => {
    it("fills a computed age beside a dated `born` and no authored `age`", () => {
        const fm = { type: "being", data: { born: "676/12/5" } };
        applyComputedBeingAge(fm, "720/1/1");
        expect(fm.data.age).toBe(43);
    });

    it("never overwrites an authored age", () => {
        const fm = { type: "being", data: { born: "676/12/5", age: 29 } };
        applyComputedBeingAge(fm, "720/1/1");
        expect(fm.data.age).toBe(29);
    });

    it("keeps an estimate verbatim and adds the normalised number beside it", () => {
        const fm = { type: "being", data: { born: "676/12/5", age: "~34" } };
        applyComputedBeingAge(fm, "720/1/1");
        expect(fm.data.age).toBe("~34");
        expect((fm.data as any).ageYears).toBe(34);
    });

    it("adds no companion beside a plain authored age", () => {
        const fm = { type: "being", data: { age: 34 } };
        applyComputedBeingAge(fm, "720/1/1");
        expect((fm.data as any).ageYears).toBeUndefined();
    });

    it("leaves `age` absent beside `born: unknown`", () => {
        const fm = { type: "being", data: { born: "unknown" } };
        applyComputedBeingAge(fm, "720/1/1");
        expect(fm.data.age).toBeUndefined();
    });

    it("leaves `age` absent when no present is declared", () => {
        const fm = { type: "being", data: { born: "676/12/5" } };
        applyComputedBeingAge(fm, null);
        expect(fm.data.age).toBeUndefined();
    });

    it("does nothing to a note of another type", () => {
        const fm = { type: "vehicle", data: { born: "676/12/5" } };
        applyComputedBeingAge(fm, "720/1/1");
        expect((fm.data as any).age).toBeUndefined();
    });

    it("computes from the retired `birthday:` spelling when `born:` is unwritten", () => {
        const fm = { type: "being", data: { birthday: "676/12/5" } };
        applyComputedBeingAge(fm, "720/1/1");
        expect((fm.data as any).age).toBe(43);
    });
});

describe("presentAmongRecords / presentAmongFrontmatters", () => {
    it("reads the present from a flat index record", () => {
        const records = [
            { type: "place", subType: "world", data: { year: { days: 360 }, present: "720/1/1" } },
        ];
        expect(presentAmongRecords(records)).toBe("720/1/1");
    });

    it("reads the present from a raw frontmatter object", () => {
        const frontmatters = [
            { type: "place", subType: "world", data: { year: { days: 360 }, present: "720/1/1" } },
        ];
        expect(presentAmongFrontmatters(frontmatters)).toBe("720/1/1");
    });

    it("is null for a batch declaring no present", () => {
        expect(presentAmongRecords([{ type: "being", data: {} }])).toBeNull();
        expect(presentAmongFrontmatters([{ type: "being", data: {} }])).toBeNull();
    });
});

describe("checkBeingAge", () => {
    it("is silent when age is not authored — nothing to disagree with", () => {
        const world = worldNote("720/1/1");
        const being = beingNote({ born: "676/12/5" });
        expect(checkBeingAge(being, { index: { notes: [world, being] } })).toEqual([]);
    });

    it("warns, naming both values, when an authored age disagrees", () => {
        const world = worldNote("720/1/1");
        const being = beingNote({ born: "676/12/5", age: 29 });
        const findings = checkBeingAge(being, { index: { notes: [world, being] } });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: "warning", file: "Being.md" });
        expect(findings[0].message).toContain("676/12/5");
        expect(findings[0].message).toContain("29");
        expect(findings[0].message).toContain("43");
    });

    it("is silent when the authored age agrees, tilde and all", () => {
        const world = worldNote("720/1/1");
        const being = beingNote({ born: "676/12/5", age: "~43" });
        expect(checkBeingAge(being, { index: { notes: [world, being] } })).toEqual([]);
    });

    it("is silent beside `born: unknown`, however the age disagrees", () => {
        const world = worldNote("720/1/1");
        const being = beingNote({ born: "unknown", age: 29 });
        expect(checkBeingAge(being, { index: { notes: [world, being] } })).toEqual([]);
    });

    it("is silent beside an absent `born`", () => {
        const world = worldNote("720/1/1");
        const being = beingNote({ age: 29 });
        expect(checkBeingAge(being, { index: { notes: [world, being] } })).toEqual([]);
    });

    it("is silent — no warning at all — when the package declares no present", () => {
        const being = beingNote({ born: "676/12/5", age: 29 });
        expect(checkBeingAge(being, { index: { notes: [being] } })).toEqual([]);
    });

    it("reaches the same result through `lintNote`, the actual lint entry point", () => {
        const world = worldNote("720/1/1");
        const being = beingNote({ born: "676/12/5", age: 29 });
        const findings = lintNote(being, { ...lintOpts, index: { notes: [world, being] } });
        const ageWarnings = findings.filter((f: any) => f.message.includes("computes to"));
        expect(ageWarnings).toHaveLength(1);
    });
});

describe("the infobox renders a computed age exactly as an authored one", () => {
    it("puts a computed age in the appearance clause", () => {
        const fm: any = { type: "being", data: { born: "676/12/5" } };
        applyComputedBeingAge(fm, "720/1/1");
        const box = noteInfobox(fm);
        const appearance = box.sections
            .flatMap((s: any) => s.rows)
            .find((r: any) => r.label === "Appearance");
        expect(appearance.value).toContain("Age 43");
    });
});

describe("the content index, end to end against a real fixture tree", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "computed-age-"));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    /** Write a note with the given frontmatter, and a one-line body. */
    function writeNote(rel: string, frontmatter: string): string {
        const full = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, `---\n${frontmatter}\n---\n\nBody.\n`);
        return full;
    }

    it("carries a computed age in the index, and never writes the note", () => {
        writeNote(
            "World.md",
            [
                "type: place",
                "subType: world",
                "id: world000000001",
                "shortcode: world",
                "name:",
                "    full: The World",
                "data:",
                "    year:",
                "        days: 360",
                "    present: 720/1/1",
            ].join("\n"),
        );
        const beingPath = writeNote(
            "Bandit.md",
            [
                "type: being",
                "id: bandit0000000001",
                "shortcode: bandit",
                "name:",
                "    full: Bandit",
                "data:",
                "    born: 676/12/5",
                "    frame: medium",
            ].join("\n"),
        );
        const before = fs.readFileSync(beingPath, "utf8");

        const records = collectContentIndex(tmp, { contentPackage: "sohl", skipDirectories: [] });
        const bandit = records.find((r: any) => r.file?.name === "Bandit");

        expect(bandit?.data?.age).toBe(43);
        expect(fs.readFileSync(beingPath, "utf8")).toBe(before);
    });

    it("carries no age at all when the package declares no present", () => {
        writeNote(
            "Bandit.md",
            [
                "type: being",
                "id: bandit0000000002",
                "shortcode: bandit2",
                "name:",
                "    full: Bandit Two",
                "data:",
                "    born: 676/12/5",
            ].join("\n"),
        );
        const records = collectContentIndex(tmp, { contentPackage: "sohl", skipDirectories: [] });
        const bandit = records.find((r: any) => r.file?.name === "Bandit");
        expect(bandit?.data?.age).toBeUndefined();
    });
});
