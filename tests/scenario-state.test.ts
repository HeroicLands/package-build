/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";

function lint(data: object) {
    const raw = `---\n${YAML.stringify({
        type: "scenario",
        subType: "adventure",
        shortcode: "raid",
        name: { full: "The Raid" },
        tags: ["draft"],
        data,
    })}---\n\nThe raiders come at dawn.\n`;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-scenario-"));
    try {
        fs.writeFileSync(path.join(root, "Raid.md"), raw);
        const { findings } = lintFrontmatter(buildLinkIndex(root, { skipDirectories: [] }), {
            schemas: ENGINE_NOTE_SCHEMAS as never,
            vocabulary: NOTE_VOCABULARY,
        });
        const lines = raw.split("\n");
        return findings.map((f) => ({ ...f, text: lines[f.line! - 1] }));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe("a scenario's state", () => {
    it("is the draft tag alone", () => expect(lint({ party: { size: "small" } })).toEqual([]));

    it("refuses a status key, at the key", () => {
        const found = lint({ status: "draft" });
        expect(found).toHaveLength(1);
        expect(found[0].severity).toBe("error");
        expect(found[0].message).toMatch(/"status" is not a `data:` property declared by scenario/);
        expect(found[0].text).toMatch(/^\s+status: draft/);
    });
});
