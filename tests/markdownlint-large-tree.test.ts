/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMarkdownlint } from "../engine/markdownlint-run.mjs";

let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "markdownlint-large-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const COUNT = 3000;
const FINDING_EVERY = 500;

describe("markdownlint on a large tree", () => {
    it("lints thousands of sources in one run", async () => {
        for (let i = 0; i < COUNT; i++) {
            const name = `note-${String(i).padStart(4, "0")}.md`;
            const body =
                i % FINDING_EVERY === 0 ?
                    `# Note ${i}\n\n::: {.verse}\n*inside*/\nsecond *line*//\n:::\n\nOutside *word*.\n`
                :   `# Note ${i}\n\nPlain text.\n`;
            fs.writeFileSync(path.join(root, name), body);
        }
        const result = await runMarkdownlint({
            directory: root,
            globs: ["*.md"],
            defaults: {
                config: { default: false, MD049: { style: "underscore" } },
                gitignore: false,
            },
            fix: false,
        });
        const expected = COUNT / FINDING_EVERY;
        expect(result.results).toHaveLength(expected * 2);
        const files = [...new Set(result.results.map((r: any) => r.fileName))];
        expect(files).toEqual(
            Array.from(
                { length: expected },
                (_, k) => `note-${String(k * FINDING_EVERY).padStart(4, "0")}.md`,
            ),
        );
        for (const r of result.results) {
            expect(r.lineNumber).toBe(8);
            expect(r.ruleNames[0]).toBe("MD049");
        }
    }, 60000);
});
