/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, subTypeCharsetMessage, subTypes } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * A note as the link index hands one over, with a real frontmatter fence so a
 * finding can be located in it. The same builder `tests/subtype-charset.test.ts`
 * uses, because these are two questions about one lint.
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

describe("a `doc` declares five genres", () => {
    it("is exactly the closed set, in the order the specification lists", () => {
        expect(subTypes("doc")).toEqual(["rules", "userguide", "reference", "howto", "concept"]);
    });

    it("accepts `howto` — a procedure a reader follows to an outcome", () => {
        expect(lintNote(note("doc", { subType: "howto" }), opts)).toEqual([]);
    });

    it("accepts `concept` — an explanation of how something works", () => {
        expect(lintNote(note("doc", { subType: "concept" }), opts)).toEqual([]);
    });

    it("keeps the genres already declared", () => {
        for (const genre of ["rules", "userguide", "reference"]) {
            expect(lintNote(note("doc", { subType: genre }), opts), genre).toEqual([]);
        }
    });

    it("declares genres only — an audience is not one of them", () => {
        // `developer` names who reads a page, not what kind of page it is.
        // Declaring it would give a developer how-to two valid values and no
        // rule for choosing between them, which is the second vocabulary the
        // field is closed against carrying.
        expect(subTypes("doc")).not.toContain("developer");
        const findings = lintNote(note("doc", { subType: "developer" }), opts);
        expect(messages(findings)).toContain("is not one of the subtypes doc declares");
    });

    it("refuses a genre it does not declare, naming the set", () => {
        const findings = lintNote(note("doc", { subType: "tutorial" }), opts);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: "error" });
        expect(messages(findings)).toContain(
            "is not one of the subtypes doc declares (rules, userguide, reference, howto, concept)",
        );
    });
});

describe("`how-to` is refused by the charset, ahead of the closed set", () => {
    // The charset is the more general statement about the same value, so it
    // runs first: a hyphenated value is refused whatever the type declares, and
    // the genres are not the reason. This is why the declared spellings are
    // `userguide` and `howto` rather than `user-guide` and `how-to`.
    const findings = () => lintNote(note("doc", { subType: "how-to" }), opts);

    it("gives the charset message, not the vocabulary one", () => {
        const [finding] = findings() as any[];
        expect(finding.message).toBe(subTypeCharsetMessage("how-to"));
        expect(finding.message).toMatch(/letters and digits/i);
    });

    it("does not quote the closed set back, which is not why it is refused", () => {
        const [finding] = findings() as any[];
        expect(finding.message).not.toContain("is not one of the subtypes");
        expect(finding.message).not.toContain("howto");
    });

    it("reports it once, and locates it on the `subType` line", () => {
        const found = findings() as any[];
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ severity: "error", line: 3, column: 1 });
    });
});
