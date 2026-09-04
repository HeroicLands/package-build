/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import {
    NOTE_VOCABULARY,
    RETIRED_SUBTYPES,
    assertVocabularyCharset,
    retiredSubType,
    subTypes,
} from "../engine/note-vocabulary.mjs";
import { ADDRESS_SEGMENT_PATTERN, isAddressSegment } from "../engine/address-charset.mjs";
import { SHORTCODE_PATTERN, isValidShortcode } from "../engine/content-lint.mjs";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * A note as the link index hands one over, with a real frontmatter fence so a
 * finding can be located in it. Same builder `tests/data-container.test.ts`
 * uses — the two ask about the same lint from the same shape of input.
 */
const note = (type: string, fm: Record<string, unknown> = {}) => {
    const body = { type, ...fm };
    const lines: string[] = [];
    for (const [key, value] of Object.entries(body)) {
        lines.push(`${key}: ${JSON.stringify(value)}`);
    }
    return {
        file: `/tree/${type}.md`,
        type,
        raw: `---\n${lines.join("\n")}\n---\n`,
        fm: body,
    };
};

const messages = (findings: Array<{ message: string }>) =>
    findings.map((f) => f.message).join("\n");

const opts = { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY };

describe("a `subType` is an address segment (#206)", () => {
    it("accepts the alphanumeric spelling `userguide` on a doc", () => {
        expect(lintNote(note("doc", { subType: "userguide" }), opts)).toEqual([]);
    });

    it("leaves every other alphanumeric subType untouched", () => {
        expect(lintNote(note("doc", { subType: "rules" }), opts)).toEqual([]);
        expect(lintNote(note("doc", { subType: "reference" }), opts)).toEqual([]);
        expect(
            lintNote(note("skill", { subType: "craft", sohl: { subType: "craft" } }), opts),
        ).toEqual([]);
    });

    it("refuses a hyphenated subType on a type that enumerates its values", () => {
        const findings = lintNote(note("trauma", { subType: "blood-loss" }), opts);
        expect(messages(findings)).toContain('`subType` "blood-loss"');
        expect(messages(findings)).toMatch(/letters and digits/i);
        expect(findings[0]).toMatchObject({ severity: "error" });
    });

    it("refuses a hyphenated subType on a type whose values are not enumerated", () => {
        // A `being`'s values are declared-but-unenumerated (`null`), so the
        // closed-set check makes no claim about them — the charset rule still
        // does, which is the whole reason it is a separate check.
        expect(subTypes("being")).toBeNull();
        const findings = lintNote(note("being", { subType: "common-folk" }), opts);
        expect(messages(findings)).toContain('`subType` "common-folk"');
        expect(messages(findings)).toMatch(/letters and digits/i);
    });

    it("refuses any non-alphanumeric character, not only the hyphen", () => {
        expect(messages(lintNote(note("being", { subType: "user guide" }), opts))).toMatch(
            /letters and digits/i,
        );
        expect(messages(lintNote(note("being", { subType: "user_guide" }), opts))).toMatch(
            /letters and digits/i,
        );
    });

    it("emits a compiler-parseable diagnostic, path first", () => {
        const subject = note("trauma", { subType: "blood-loss" });
        const [finding] = lintNote(subject, opts);
        // `---`, `type:`, then `subType:` — file line 3, column 1.
        expect(finding).toMatchObject({ file: subject.file, line: 3, column: 1 });
        expect(formatDiagnostic(finding as any)).toMatch(/^\/tree\/trauma\.md:3:1: error: .+/);
    });

    it("says the rule once, reading the shared pattern", () => {
        // Not a second copy of the regex: the message quotes the one pattern
        // the shortcode is held to as well.
        expect(SHORTCODE_PATTERN).toBe(ADDRESS_SEGMENT_PATTERN);
    });
});

describe("`user-guide` is accepted transitionally, and says so (#206)", () => {
    const findings = () => lintNote(note("doc", { subType: "user-guide" }), opts);

    it("accepts it — a consumer cannot sweep ahead of the release that renames it", () => {
        // Accepted means: not refused. The build proceeds, so the 43 notes
        // authored on the old spelling still compile.
        expect(findings().filter((f: any) => f.severity === "error")).toEqual([]);
    });

    it("is not silent — one finding, naming the note, the old value and the new", () => {
        const [finding] = findings() as any[];
        expect(finding.file).toBe("/tree/doc.md");
        expect(finding.message).toContain("user-guide");
        expect(finding.message).toContain("userguide");
    });

    it("is a warning, not an error", () => {
        // The note compiles to the correct page, and erroring would red every
        // consumer the moment it took this release — the ordering this change
        // exists to avoid. The refusal comes after the sweep.
        expect((findings()[0] as any).severity).toBe("warning");
    });

    it("locates it on the `subType` line", () => {
        expect(findings()[0]).toMatchObject({ line: 3, column: 1 });
    });

    it("does not also report it as a charset violation or an undeclared value", () => {
        expect(findings()).toHaveLength(1);
    });

    it("records the retirement as data, keyed by type", () => {
        expect(retiredSubType("doc", "user-guide")).toBe("userguide");
        expect(retiredSubType("doc", "userguide")).toBeUndefined();
        // Retired on a `doc` and nowhere else — a `being` subtype spelled the
        // same way is a charset violation, not a rename.
        expect(retiredSubType("being", "user-guide")).toBeUndefined();
        expect(RETIRED_SUBTYPES).toHaveProperty("doc");
    });
});

describe("a `type` is an address segment (#206)", () => {
    it("refuses a hyphenated type, at the `type` line", () => {
        const subject = note("user-guide", { shortcode: "abc" });
        const [finding] = lintNote(subject, opts) as any[];
        expect(finding.message).toContain('content type "user-guide"');
        expect(finding.message).toMatch(/letters and digits/i);
        expect(finding.severity).toBe("error");
        // Column 8 is the value itself, not the key: the same locator a
        // retired type gets, since it is the value that has to change.
        expect(formatDiagnostic(finding)).toMatch(/^\/tree\/user-guide\.md:2:8: error: /);
    });

    it("reports the charset once, rather than also as an undeclared type", () => {
        const findings = lintNote(note("user-guide"), opts);
        expect(messages(findings)).not.toContain("no schema is declared");
    });

    it("leaves an alphanumeric type alone", () => {
        expect(lintNote(note("weapongear"), opts)).toEqual([]);
    });

    it("still reports a missing type as a missing schema, not a charset violation", () => {
        const subject = { file: "/tree/none.md", type: "", raw: "---\n---\n", fm: {} };
        const findings = lintNote(subject, opts);
        expect(messages(findings)).toContain("no schema is declared");
        expect(messages(findings)).not.toMatch(/letters and digits/i);
    });

    it("has no transitional path — no authored type breaks the rule today", () => {
        // Deliberately asymmetric with `subType`: a transitional acceptance for
        // types would guard a case that does not exist in any tree.
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            expect(isAddressSegment(type), type).toBe(true);
        }
    });
});

describe("the declared vocabulary is held to the same rule (#206)", () => {
    it("declares no hyphenated type or subType", () => {
        expect(() => assertVocabularyCharset(NOTE_VOCABULARY)).not.toThrow();
    });

    it("declares `userguide` for a doc, and no longer `user-guide`", () => {
        expect(subTypes("doc")).toContain("userguide");
        expect(subTypes("doc")).not.toContain("user-guide");
    });

    it("refuses a hyphenated declaration, naming the offender", () => {
        expect(() =>
            assertVocabularyCharset({
                "user-guide": { data: [] },
            } as any),
        ).toThrow(/user-guide/);
        expect(() =>
            assertVocabularyCharset({
                doc: { data: [], subTypes: ["user-guide"] },
            } as any),
        ).toThrow(/user-guide/);
    });
});

describe("the shortcode rule is untouched (#206)", () => {
    it("still accepts and refuses exactly what it did", () => {
        expect(isValidShortcode("clmb")).toBe(true);
        expect(isValidShortcode("Clmb42")).toBe(true);
        expect(isValidShortcode("harn-adventures")).toBe(false);
        expect(isValidShortcode("")).toBe(false);
    });

    it("is the same pattern, not a copy of it", () => {
        expect(SHORTCODE_PATTERN).toBe(ADDRESS_SEGMENT_PATTERN);
    });
});
