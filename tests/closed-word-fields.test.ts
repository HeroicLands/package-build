/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/** The declaration of one `data.` field of a being. */
function declared(name: string) {
    const spec = NOTE_VOCABULARY.being.data.find((entry: any) => entry.name === name);
    if (!spec) throw new Error(`being declares no ${name}`);
    return spec as { allowed?: readonly string[]; describe: string };
}

/** Lint a being whose frontmatter is `raw`, with `data` as its parsed `data:` map. */
function lintBeing(raw: string, data: Record<string, unknown>) {
    const fm = { type: "being", subType: "character", name: { full: "A Person" }, data };
    return lintNote({ file: "assets/content/Person.md", type: "being", raw, fm } as any, {
        schemas: NOTE_SCHEMAS,
        vocabulary: NOTE_VOCABULARY,
    });
}

const fence = (...lines: string[]) => ["---", ...lines, "---", ""].join("\n");

describe.each(["gender", "frame"])("a being's %s", (field) => {
    const words = () => declared(field).allowed ?? [];
    const about = (findings: any[]) => findings.filter((f) => f.message.includes(`data.${field}`));

    it("declares its closed list", () => {
        expect(words().length).toBeGreaterThan(1);
    });

    it("names every declared word in its description", () => {
        for (const word of words()) expect(declared(field).describe).toContain(`\`${word}\``);
    });

    it("accepts each declared word", () => {
        for (const word of words()) {
            const raw = fence("type: being", "data:", `  ${field}: ${word}`);
            expect(about(lintBeing(raw, { [field]: word }))).toEqual([]);
        }
    });

    it("refuses any other word, located at the value", () => {
        const raw = fence("type: being", "data:", `  ${field}: bloke`);
        const findings = about(lintBeing(raw, { [field]: "bloke" }));
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: "error", line: 4, column: field.length + 5 });
        for (const word of words()) expect(findings[0].message).toContain(`\`${word}\``);
    });

    it("leaves an absent field legal", () => {
        const raw = fence("type: being", "data: {}");
        expect(about(lintBeing(raw, {}))).toEqual([]);
    });
});
