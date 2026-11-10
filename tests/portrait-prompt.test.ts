/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * `data.portrait.prompt` holds the exact text a portrait was generated from.
 * A being with no `portrait` block has no portrait yet and is valid.
 */

const file = "assets/content/Beings/Someone.md";

function being(dataLines: string[]) {
    const raw = [
        "---",
        "shortcode: someone",
        'name: { full: "Someone" }',
        "type: being",
        "subType: creature",
        "data:",
        ...dataLines,
        "---",
        "",
        "Someone stands in the road and looks at the travellers as they pass by the inn door.",
        "",
    ].join("\n");
    return { file, raw, type: "being", fm: YAML.parse(raw.split("---\n")[1]) };
}

const lint = (note: ReturnType<typeof being>) =>
    lintNote(note as any, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY } as any);

describe("a being's portrait prompt", () => {
    it("is valid when absent: no portrait block, no diagnostics", () => {
        expect(lint(being(["    gender: female", "    frame: light"]))).toEqual([]);
        expect(lint(being(["    gender: female"]))).toEqual([]);
    });

    it("accepts the text a portrait was made from, multi-line text included", () => {
        const note = being([
            "    portrait:",
            "        prompt: >-",
            "            A weathered woman with braided dark hair, an angular face",
            "            and a thin mouth, head and shoulders.",
        ]);
        expect(lint(note)).toEqual([]);
        expect(note.fm.data.portrait.prompt).toContain("angular face and a thin mouth");
    });

    it("refuses a blank prompt at the value", () => {
        const note = being(["    portrait:", '        prompt: "  "']);
        const findings = lint(note);
        expect(findings).toHaveLength(1);
        expect(formatDiagnostic(findings[0])).toMatch(
            new RegExp(`^${file}:8:17: error: .*data\\.portrait\\.prompt`),
        );
    });

    it("refuses a prompt that is not text, and a key the block does not declare", () => {
        const notText = lint(being(["    portrait:", "        prompt: [one, two]"]));
        expect(notText.some((f: any) => f.message.includes("portrait.prompt"))).toBe(true);
        const stray = lint(
            being(["    portrait:", "        prompt: A face.", "        model: flux"]),
        );
        expect(stray.some((f: any) => f.message.includes('"model"'))).toBe(true);
    });
});
