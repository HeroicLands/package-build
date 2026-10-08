/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A rung states its level, its title and its description, or it is a finding.
 * What a rung holds is checked by the inner-key check from the declaration;
 * the ladder's own rules — a whole-number level, held by one rung — by
 * `checkRankLadder`.
 *
 * Every case below is driven from an authored YAML fixture rather than from a
 * hand-built object, because half of what is being checked is the position: a
 * finding about a rung has to name the line that rung is written on, and only
 * a real frontmatter fence has lines.
 */

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { checkAffiliationRankFloor, checkRankLadder } from "../engine/rank-ladder.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { checkDataKeys } from "../engine/data-keys.mjs";

/**
 * A note as the linter hands it to a field check: the raw source, and the
 * frontmatter parsed out of it.
 *
 * @param fence - The YAML body of the note's frontmatter fence.
 */
function note(fence: string) {
    const raw = `---\n${fence}\n---\n\nProse.\n`;
    return {
        file: "assets/content/Affiliations/Vrystwald_Tribes.md",
        raw,
        fm: YAML.parse(fence) as Record<string, unknown>,
    };
}

/** The ladder fence, with each rung written as authored. */
function ladder(...rungs: string[]) {
    return [
        "type: affiliation",
        "shortcode: vrystwldtrbs",
        "data:",
        "    governance:",
        "        ranks:",
        ...rungs,
    ].join("\n");
}

describe("a complete rung", () => {
    // The whole contract: three keys, nothing further required, and in
    // particular no advisory about the `lore` a rung did not need.
    it("is clean with exactly level, title and description", () => {
        expect(
            checkRankLadder(
                note(
                    ladder(
                        "            - { level: 5, title: Hárár, description: First among them. }",
                    ),
                ),
            ),
        ).toEqual([]);
    });

    it("is clean with a lore Address as well", () => {
        expect(
            checkRankLadder(
                note(
                    ladder(
                        "            - level: 5",
                        "              title: Hárár",
                        "              description: First among them.",
                        "              lore: lore-harar-standing",
                    ),
                ),
            ),
        ).toEqual([]);
    });

    it("is clean for a body that declares no ladder", () => {
        expect(checkRankLadder(note("type: affiliation\nshortcode: greenwardens"))).toEqual([]);
    });

    // `kind: "list"` on the field already reports a ranks that is not a list,
    // and a finding reported twice is read once and fixed neither time.
    it("leaves a ranks that is not a list to the shape check", () => {
        expect(
            checkRankLadder(
                note("type: affiliation\ndata:\n    governance:\n        ranks: a ladder"),
            ),
        ).toEqual([]);
    });
});

/**
 * Every finding a ladder earns: what a rung holds is the inner-key check's,
 * read from the declaration, and what a ladder means is the rung check's.
 */
function ladderFindings(subject: { file: string; raw?: string; fm: Record<string, unknown> }) {
    return [...checkDataKeys(subject, dataFields("affiliation")), ...checkRankLadder(subject)];
}

const allMessages = (fence: string) => ladderFindings(note(fence)).map((f) => f.message);

describe("an incomplete rung", () => {
    it("reports a missing level", () => {
        expect(allMessages(ladder("            - { title: Hárár, description: First. }"))).toEqual([
            "`data.governance.ranks[0]` must state `level` — a whole number — the rung's position on this body's own ladder",
        ]);
    });

    it("reports a missing title", () => {
        expect(allMessages(ladder("            - { level: 5, description: First. }"))).toEqual([
            "`data.governance.ranks[0]` must state `title` — what the standing is called",
        ]);
    });

    it("reports a missing description", () => {
        expect(allMessages(ladder("            - { level: 5, title: Hárár }"))).toEqual([
            "`data.governance.ranks[0]` must state `description` — what the standing is",
        ]);
    });

    it("reports an empty title and an empty description as absent", () => {
        expect(
            allMessages(ladder('            - { level: 5, title: "", description: "   " }')),
        ).toEqual([
            "`data.governance.ranks[0]` must state `title` — what the standing is called",
            "`data.governance.ranks[0]` must state `description` — what the standing is",
        ]);
    });

    // Three problems, three findings: a reader fixing a ladder wants the whole
    // of it in one pass rather than one problem per build.
    it("reports every problem on one rung, not the first", () => {
        expect(allMessages(ladder("            - {}"))).toEqual([
            "`data.governance.ranks[0]` must state `level` — a whole number — the rung's position on this body's own ladder",
            "`data.governance.ranks[0]` must state `title` — what the standing is called",
            "`data.governance.ranks[0]` must state `description` — what the standing is",
        ]);
    });

    it("reports a level that is not a whole number", () => {
        expect(
            allMessages(ladder("            - { level: 2.5, title: Hárár, description: First. }")),
        ).toEqual(["rank 1 of the ladder has a level that is not a whole number"]);
    });

    it("reports a level that is not a number at all, once", () => {
        expect(
            allMessages(
                ladder("            - { level: fifth, title: Hárár, description: First. }"),
            ),
        ).toEqual([
            "`data.governance.ranks[0].level` should be a whole number — the rung's position on this body's own ladder, but reads \"fifth\"",
        ]);
    });

    // YAML hands a quoted scalar back as a string, and the ladder reads it as a
    // number either way, so refusing it would fail a correct ladder.
    it("accepts a quoted whole number", () => {
        expect(
            allMessages(ladder('            - { level: "5", title: Hárár, description: First. }')),
        ).toEqual([]);
    });

    it("reports a rung that is not a map", () => {
        expect(allMessages(ladder("            - Hárár"))).toEqual([
            '`data.governance.ranks[0]` should be a map — `{ level, title, description, lore? }`, but reads "Hárár"',
        ]);
    });

    it("reports a key that is none of the four", () => {
        expect(
            allMessages(
                ladder(
                    "            - { level: 5, title: Hárár, description: First., insignia: A horn. }",
                ),
            ),
        ).toEqual([
            '"insignia" is not a key of `data.governance.ranks[0]`; it takes only `level`, `title`, `description`, `lore`',
        ]);
    });

    it("names each rung of a ladder with several problems", () => {
        expect(
            allMessages(
                ladder(
                    "            - { level: 0, title: Vrystrith, description: Outcast. }",
                    "            - { level: 4, description: Respected. }",
                    "            - { title: Hárár, description: First. }",
                ),
            ),
        ).toEqual([
            "`data.governance.ranks[1]` must state `title` — what the standing is called",
            "`data.governance.ranks[2]` must state `level` — a whole number — the rung's position on this body's own ladder",
        ]);
    });
});

describe("where a finding points", () => {
    const fence = ladder(
        "            - { level: 0, title: Vrystrith, description: Outcast. }",
        "            - level: 4",
        "              title: Fródrád",
        "              insignia: A horn.",
        "            - { level: 5, title: Hárár }",
    );

    it("names the file on every finding", () => {
        for (const finding of ladderFindings(note(fence))) {
            expect(finding.file).toBe("assets/content/Affiliations/Vrystwald_Tribes.md");
            expect(finding.severity).toBe("error");
        }
    });

    // An undeclared key has a position of its own, so the finding points at
    // the key rather than at the rung holding it.
    it("points at an undeclared key's own line and column", () => {
        const unknownKey = ladderFindings(note(fence)).find((f) => f.message.includes("insignia"));
        const lines = note(fence).raw.split("\n");

        expect(unknownKey).toBeDefined();
        expect(lines[(unknownKey!.line as number) - 1]).toContain("insignia: A horn.");
        expect(lines[(unknownKey!.line as number) - 1][(unknownKey!.column as number) - 1]).toBe(
            "i",
        );
    });

    // A key that was never written has no position, so the rung it belongs to
    // is the nearest thing that does — rather than a guessed `1:1`, which
    // would send a reader to the frontmatter's first line every time.
    it("falls back to the rung for a key that was never written", () => {
        const findings = ladderFindings(note(fence));
        const lines = note(fence).raw.split("\n");
        const lineOf = (message: string) => {
            const finding = findings.find((f) => f.message === message);
            expect(finding).toBeDefined();
            return lines[(finding!.line as number) - 1];
        };

        // A rung written as a block maps to its first key's line, and one
        // written in flow to the brace that opens it. Both are the rung.
        expect(
            lineOf("`data.governance.ranks[1]` must state `description` — what the standing is"),
        ).toContain("level: 4");
        expect(
            lineOf("`data.governance.ranks[2]` must state `description` — what the standing is"),
        ).toContain("level: 5, title: Hárár");
    });

    it("drops the position rather than guessing when there is no source", () => {
        const findings = ladderFindings({
            file: "x.md",
            fm: { data: { governance: { ranks: [{}] } } },
        });

        expect(findings.length).toBe(3);
        for (const finding of findings) {
            expect(finding.line).toBeUndefined();
            expect(finding.column).toBeUndefined();
        }
    });
});

describe("one level, one rung", () => {
    it("reports the second rung at one level, naming the first", () => {
        const findings = checkRankLadder(
            note(
                ladder(
                    "            - { level: 4, title: Knight, description: Holds land by service. }",
                    "            - { level: 4, title: Dame, description: Holds land by service. }",
                ),
            ),
        );

        expect(findings.map((f) => f.message)).toEqual([
            'rank 4 is declared twice, as "Knight" and "Dame"; a level is a rung\'s ' +
                "identity and a member's rank indexes into it, so each rung states its own",
        ]);
    });

    it("opens the finding on the second rung, not the first", () => {
        const fence = ladder(
            "            - { level: 4, title: Knight, description: Holds land by service. }",
            "            - { level: 4, title: Dame, description: Holds land by service. }",
        );
        const [finding] = checkRankLadder(note(fence));
        const lines = `---\n${fence}\n---\n\nProse.\n`.split("\n");

        expect(lines[(finding.line as number) - 1]).toContain("Dame");
    });

    it("names a titleless rung by its position, since it has no title to quote", () => {
        const messages = checkRankLadder(
            note(
                ladder(
                    "            - { level: 4, title: Knight, description: Holds land by service. }",
                    "            - { level: 4, description: Holds land by service. }",
                ),
            ),
        ).map((f) => f.message);

        expect(messages).toContain(
            'rank 4 is declared twice, as "Knight" and rank 4; a level is a rung\'s ' +
                "identity and a member's rank indexes into it, so each rung states its own",
        );
    });

    it("says nothing about a ladder whose levels are distinct", () => {
        expect(
            checkRankLadder(
                note(
                    ladder(
                        "            - { level: 0, title: Vrystrith, description: Kinless. }",
                        "            - { level: 4, title: Fródrád, description: Respected. }",
                        "            - { level: 5, title: Hárár, description: First among them. }",
                    ),
                ),
            ),
        ).toEqual([]);
    });

    it("counts a quoted level as the number it states", () => {
        // YAML hands a quoted scalar back as a string, and the ladder reads it
        // as a number either way — so `"4"` and `4` are one level.
        const messages = checkRankLadder(
            note(
                ladder(
                    '            - { level: "4", title: Knight, description: Holds land. }',
                    "            - { level: 4, title: Dame, description: Holds land. }",
                ),
            ),
        ).map((f) => f.message);

        expect(messages.some((m) => m.includes("declared twice"))).toBe(true);
    });
});

describe("the vocabulary", () => {
    // The check reaches a note because the field declares it. Wiring it is the
    // half that a passing unit test cannot observe, so it is read out of the
    // vocabulary rather than assumed.
    it("declares the check on governance.ranks", () => {
        const fields = (
            NOTE_VOCABULARY as unknown as Record<
                string,
                { data?: Array<{ name: string; check?: unknown }> }
            >
        ).affiliation.data;
        const field = fields?.find((f) => f.name === "governance.ranks");

        expect(field).toBeDefined();
        expect(field?.check).toBe(checkRankLadder);
    });
});

describe("an affiliation's minimum standing", () => {
    const base = "type: affiliation\ndata:\n    governance:";

    it("reports a missing ranks key at governance", () => {
        const source = note(`${base}\n        model: A council.`);
        const [finding] = checkAffiliationRankFloor(source);
        expect(finding).toMatchObject({
            file: source.file,
            line: 4,
            column: 5,
            severity: "error",
        });
        expect(finding.message).toContain("needs data.governance.ranks with a level 1");
    });

    it("reports an empty ranks list at ranks", () => {
        const [finding] = checkAffiliationRankFloor(note(`${base}\n        ranks: []`));
        expect(finding).toMatchObject({ line: 5, column: 9, severity: "error" });
    });

    it("reports a ladder without level 1", () => {
        const [finding] = checkAffiliationRankFloor(
            note(ladder("            - { level: 2, title: Elder, description: Leads. }")),
        );
        expect(finding).toMatchObject({ line: 6, column: 9, severity: "error" });
        expect(finding.message).toContain("needs a level 1 standing");
    });

    it("accepts a single level 1 rung", () => {
        expect(
            checkAffiliationRankFloor(
                note(ladder("            - { level: 1, title: Member, description: Belongs. }")),
            ),
        ).toEqual([]);
    });

    it("is wired to affiliation notes", () => {
        expect(NOTE_VOCABULARY.affiliation.check).toBe(checkAffiliationRankFloor);
    });
});
