/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

function findings(archetypes: string[]) {
    return lintNote(
        {
            file: "Being.md",
            raw: `---\ntype: being\ndata:\n  archetypes: [${archetypes.join(", ")}]\n---\n`,
            fm: { type: "being", data: { archetypes } },
        },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
}

describe("the commoner archetype", () => {
    it("stands alone", () => {
        expect(findings(["commoner"])).toEqual([]);
        expect(findings(["entertainer", "guildsperson"])).toEqual([]);
        const mixed = findings(["commoner", "guildsperson"]);
        expect(mixed).toHaveLength(1);
        expect(mixed[0]).toMatchObject({
            file: "Being.md",
            line: 4,
            severity: "error",
            message: "`data.archetypes` may contain `commoner` only by itself",
        });
    });
});
