/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **The keys the actor pass reads and the keys a `being` may write are one
 * set.**
 *
 * A key read by no pass and a key read by a pass that no vocabulary declares
 * are the same quiet failure from either end: the note states a fact, one side
 * of the build accepts it, and nothing says the other never saw it.
 *
 * So the two halves are compared rather than trusted. The vocabulary comes from
 * the declarations at runtime and the reads are taken out of the pass's own
 * source, which means a key struck from one side and left on the other fails
 * here instead of shipping. A **retired** entry is held to the opposite rule:
 * it is declared so its refusal can name the position to write instead, and it
 * must have no reader at all.
 *
 * A declared key with no reader *here* is not a fault — `attrRollFormula` is
 * read by the publishing sites rather than by any compile pass — so the
 * completeness claim runs in the direction the reads can answer.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { authoredFields, retiredKeyFields } from "../engine/field-spec.mjs";
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
    it("finds reads and retirements at all, so an empty set cannot pass by accident", () => {
        expect(READS.size).toBeGreaterThan(0);
        expect(retiredKeyFields(BEING).length).toBeGreaterThan(0);
    });

    it("reads nothing the vocabulary does not accept", () => {
        const accepted = new Set(authoredFields(BEING).map((field: any) => field.name));
        expect([...READS].filter((key) => !accepted.has(key))).toEqual([]);
    });

    it("reads no retired key", () => {
        const stillRead = retiredKeyFields(BEING)
            .map((field: any) => field.retiredKey)
            .filter((key: string) => READS.has(key));
        expect(stillRead).toEqual([]);
    });

    it("keeps a retired entry out of the vocabulary an author is shown", () => {
        // No `name`, so `authoredFields` excludes it and every surface built on
        // that list — the generated reference included — reads as though the
        // key were not in the vocabulary.
        for (const field of retiredKeyFields(BEING) as any[]) {
            expect(field.name).toBeUndefined();
            expect(field.to).toBeUndefined();
            expect(typeof field.retired).toBe("string");
            expect(field.retired.length).toBeGreaterThan(0);
        }
    });

    it("names no key on both sides", () => {
        const authored = new Set(authoredFields(BEING).map((field: any) => field.name));
        const retired = retiredKeyFields(BEING).map((field: any) => field.retiredKey);
        expect(retired.filter((key: string) => authored.has(key))).toEqual([]);
    });
});

describe("a note that writes a retired key", () => {
    const note = (sohl: Record<string, unknown>) => ({
        fm: { type: "being", subType: "creature", shortcode: "someone", sohl },
        file: "Characters/Someone.md",
        raw: "",
    });
    const messages = (sohl: Record<string, unknown>) =>
        lintNote(note(sohl), { schemas: NOTE_SCHEMAS }).map((finding: any) => finding.message);

    it("is told the key is retired and where the value belongs", () => {
        for (const field of retiredKeyFields(BEING) as any[]) {
            const found = messages({ [field.retiredKey]: {} }).filter((message: string) =>
                message.includes(`\`sohl.${field.retiredKey}:\` is a retired frontmatter key`),
            );
            expect(found).toHaveLength(1);
            expect(found[0]).toContain(field.retired);
        }
    });

    it("is not also told the key is unrecognised, which would say less", () => {
        for (const field of retiredKeyFields(BEING) as any[]) {
            expect(messages({ [field.retiredKey]: {} })).not.toContain(
                expect.stringContaining("is not a property of a being"),
            );
        }
    });

    it("is sent to `sohl.system.body` for a body, which is where a being writes one", () => {
        const [found] = messages({ body: { weight: { base: 180 } } }).filter((message: string) =>
            message.includes("retired frontmatter key"),
        );
        expect(found).toContain("`sohl.system.body`");
    });

    it("is sent to `sohl.items` for attributes and for skills", () => {
        for (const key of ["attributes", "skills"]) {
            const [found] = messages({ [key]: {} }).filter((message: string) =>
                message.includes("retired frontmatter key"),
            );
            expect(found).toContain("`sohl.items`");
        }
    });

    it("says nothing about a being that writes its body under `sohl.system`", () => {
        expect(
            messages({ system: { body: { weight: { base: 180 } }, currentMoveMedium: "walk" } }),
        ).toEqual([]);
    });
});
