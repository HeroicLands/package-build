/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **The actor pass reads nothing a `being` may not write.**
 *
 * A pass reading a key no vocabulary declares is a quiet failure from both
 * ends at once: the frontmatter check refuses the key, so no note can supply
 * it, and the read sits there looking like a feature. The reverse — a declared
 * key the pass does not read — is not a fault, because `attrRollFormula` is
 * read by the publishing sites rather than by any compile pass, so the claim
 * runs in the direction the reads can answer.
 *
 * The two halves are compared rather than trusted: the vocabulary comes from
 * the declarations at runtime and the reads are taken out of the pass's own
 * source, so a key struck from the declaration and left in the pass fails here
 * instead of shipping.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { authoredFields } from "../engine/field-spec.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
// eslint-disable-next-line
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The pass's own source, which is where a read can be seen. */
const PASS = fs.readFileSync(path.join(HERE, "..", "sohl", "actors.mjs"), "utf8");

/** A being's `sohl:` declarations, as the linter is handed them. */
const BEING = (NOTE_SCHEMAS as unknown as Record<string, any[]>).being;

/** Every in-block key the pass reads, taken from the pass itself. */
const READS = new Set([...PASS.matchAll(/sohlField\(fm, "([^"]+)"/g)].map((match) => match[1]));

describe("the accepted keys and the keys the pass reads", () => {
    it("finds reads at all, so an empty set cannot pass by accident", () => {
        expect(READS.size).toBeGreaterThan(0);
        expect(authoredFields(BEING).length).toBeGreaterThan(0);
    });

    it("reads nothing the vocabulary does not accept", () => {
        const accepted = new Set(authoredFields(BEING).map((field: any) => field.name));
        expect([...READS].filter((key) => !accepted.has(key))).toEqual([]);
    });
});

describe("a being's block, as the frontmatter check holds it", () => {
    const note = (sohl: Record<string, unknown>, raw = "") => ({
        fm: { type: "being", subType: "creature", shortcode: "someone", sohl },
        file: "Characters/Someone.md",
        raw,
    });
    const findings = (sohl: Record<string, unknown>, raw = "") =>
        lintNote(note(sohl, raw), { schemas: NOTE_SCHEMAS }) as any[];

    it("refuses a key the vocabulary does not declare, at the line it is written on", () => {
        // The whole of what a key outside the vocabulary meets: the block is
        // closed, so an unrecognised key in it is an error rather than a value
        // discarded in silence.
        const raw = [
            "---",
            "type: being",
            "subType: creature",
            "shortcode: someone",
            "sohl:",
            "    thews: 14",
            "---",
            "",
        ].join("\n");
        const found = findings({ thews: 14 }, raw);

        expect(found.map((finding) => finding.severity)).toEqual(["error"]);
        expect(found[0].message).toContain('"thews" is not a property of a being');
        expect(found[0].message).toContain("discarded at compile with no warning");
        expect(found[0].line).toBe(6);
    });

    it("says nothing about the fields a being authors under `sohl.system`", () => {
        // The passthrough's region, written at the data model's own paths — a
        // body and the movement that goes with it.
        expect(
            findings({
                system: {
                    body: { weight: { base: 180 } },
                    currentMoveMedium: "terrestrial",
                    movementProfiles: [{ medium: "terrestrial", feetPerRound: 20 }],
                },
            }),
        ).toEqual([]);
    });

    it("says nothing about the two keys the pass does read", () => {
        expect(findings({ items: [], defaultCombatGroup: "melee" })).toEqual([]);
    });
});
