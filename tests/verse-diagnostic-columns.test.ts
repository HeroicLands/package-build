/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { scanVerse, workShapeFindings } from "../engine/content-verse.mjs";

describe("verse opener diagnostic columns", () => {
    it.each([
        ["- item\n\n  ", 3],
        ["> ", 3],
        ["- outer\n\n  - inner\n\n    > ", 7],
    ])("locates a refused fence after %j", (prefix, column) => {
        const source = `${prefix}\`\`\`verse lang=en\n  A line\n  \`\`\`\n`;
        const line = prefix.split("\n").length;
        expect(scanVerse(source).errors).toContainEqual({
            line,
            column,
            message: expect.stringContaining("verse uses a .verse div"),
        });
    });

    it.each([
        ["- item\n\n  ", 3],
        ["> ", 3],
        ["- outer\n\n  - inner\n\n    > ", 7],
    ])("locates a single work version after %j", (prefix, column) => {
        const source = `${prefix}::: {.verse work=w}\n  One\n  :::\n`;
        expect(scanVerse(source).errors).toContainEqual({
            line: prefix.split("\n").length,
            column,
            message: "work=w has only one version",
        });
    });

    const versions = (first: string, second: string) =>
        "- item\n\n" +
        `  ::: {.verse work=w}\n${first
            .split("\n")
            .map((line) => (line ? "  " + line : line))
            .join("\n")}\n  :::\n\n` +
        `   ::: {.verse work=w}\n${second
            .split("\n")
            .map((line) => (line ? "   " + line : line))
            .join("\n")}\n   :::\n`;

    it.each([
        ["One\n\nTwo", "Three", "stanzas"],
        ["One\n\n--- {.canto}\n\nTwo", "Three", "cantos"],
    ])("locates both mismatched versions (%s)", (first, second, kind) => {
        const result = scanVerse(versions(first, second));
        const findings = result.errors.filter((error) => error.message.includes(kind));
        expect(findings).toHaveLength(2);
        expect(findings.map(({ line, column }) => ({ line, column }))).toEqual(
            result.blocks.map((block, index) => ({ line: block.start + 1, column: index + 3 })),
        );
    });

    it.each([
        ["One", undefined],
        ["One\n\nTwo", "Three"],
        ["One\n\n--- {.canto}\n\nTwo", "Three"],
    ])(
        "omits columns for externally supplied versions without opener positions (%s)",
        (first, second) => {
            const source =
                second === undefined ?
                    `::: {.verse work=w}\n${first}\n:::`
                :   versions(first, second);
            const blocks = scanVerse(source).blocks.map(({ column, ...block }) => block);
            const findings = workShapeFindings(blocks);
            expect(findings.length).toBeGreaterThan(0);
            for (const finding of findings) expect(finding).not.toHaveProperty("column");
        },
    );
});
