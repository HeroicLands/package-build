/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMarkdownlint } from "../engine/markdownlint-run.mjs";

let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "verse-markdownlint-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (source: string) => {
    const file = path.join(root, "note.md");
    fs.writeFileSync(file, source);
    return file;
};
const lint = (fix = false, config = {}) =>
    runMarkdownlint({
        directory: root,
        globs: ["*.md"],
        defaults: {
            config: { default: false, MD049: { style: "underscore" }, MD052: true, ...config },
            gitignore: false,
        },
        fix,
    });

describe("verse in Markdown lint", () => {
    it.each(["\n", "\r\n"])(
        "retains prose findings after multiline verse with %j endings",
        async (newline) => {
            for (const fenced of [false, true]) {
                const source =
                    "# T\n\nPara [one/\ntwo/\nfourfive]{.verse lang=en} *end*.\n" +
                    (fenced ? "\n```text\ncode\n```\n" : "");
                const original = source.replace(/\n/g, newline);
                const file = write(original);
                const result = await lint(false, { MD046: true });
                const column = "fourfive]{.verse lang=en} *end*.".indexOf("*") + 1;
                expect(
                    result.results.map((error: any) => [
                        error.lineNumber,
                        error.ruleNames[0],
                        error.errorRange,
                    ]),
                ).toEqual([
                    [5, "MD049", [column, 1]],
                    [5, "MD049", [column + 4, 1]],
                ]);
                expect((await lint(true, { MD046: true })).results).toEqual([]);
                expect(fs.readFileSync(file, "utf8")).toBe(original.replace("*end*", "_end_"));
            }
        },
    );

    it("counts footnotes used in divs and inline quotations without hiding unused definitions", async () => {
        const source =
            "> ::: {.verse lang=en}\n> The word[^div].\n> :::\n\nA [word[^span]/]{.verse lang=en}.\n\n[^div]: Div note.\n[^span]: Quotation note.\n[^unused]: Unused note.\n";
        const file = write(source);
        const result = await lint(false, { MD053: true });
        expect(result.results.map((error: any) => [error.lineNumber, error.ruleNames[0]])).toEqual([
            [9, "MD053"],
        ]);
        expect((await lint(true, { MD053: true })).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(source.replace("[^unused]: Unused note.\n", ""));
    });

    it("counts actual reference links and images with normalized labels and retains duplicates", async () => {
        write(
            "::: {.verse lang=en}\n[A link][A   LABEL]/[Collapsed][]/[Shortcut]/![A picture][picture]\n:::\n\n[a label]: https://example.com\n[collapsed]: https://example.com\n[shortcut]: https://example.com\n[picture]: picture.png\n[a label]: https://duplicate.example\n[unused]: https://example.com\n",
        );
        const result = await lint(false, { MD053: true });
        expect(result.results.map((error: any) => [error.lineNumber, error.errorDetail])).toEqual([
            [9, 'Duplicate link or image reference definition: "a label"'],
            [10, 'Unused link or image reference definition: "unused"'],
        ]);
    });

    it("does not treat escaped, code, metadata or commented references as usages", async () => {
        write(
            '::: {.verse lang=en}\n`[^code] [code-link]`/\\[^escaped]/\\[escaped-link]/<!-- [^comment] [comment-link] -->/[word]{title="[^metadata]"}\n:::\n\n[^code]: Code.\n\n[code-link]: https://example.com\n\n[^escaped]: Escaped.\n\n[escaped-link]: https://example.com\n\n[^comment]: Comment.\n\n[comment-link]: https://example.com\n\n[^metadata]: Metadata.\n',
        );
        const result = await lint(false, { MD053: true });
        expect(
            result.results
                .filter((error: any) => error.ruleNames.includes("MD053"))
                .map((error: any) => error.lineNumber),
        ).toEqual([5, 7, 9, 11, 13, 15, 17]);
    });

    it("does not report used verse footnotes in the actual parity corpus fixture", async () => {
        const source = fs.readFileSync(
            new URL("./fixtures/parity/assets/content/Lore/lore-corpus.md", import.meta.url),
            "utf8",
        );
        const file = write(source);
        expect((await lint(true, { MD053: true })).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(source);
    });

    it("counts definition labels rather than inferring usage from matching destinations", async () => {
        write(
            "::: {.verse lang=en}\n[Used][used]/[An inline link](https://example.com)\n:::\n\n[used]: https://example.com\n[unused]: https://example.com\n",
        );
        const result = await lint(false, { MD053: true });
        expect(result.results.map((error: any) => [error.lineNumber, error.errorDetail])).toEqual([
            [6, 'Unused link or image reference definition: "unused"'],
        ]);
    });

    it("does not manufacture shortcut reference usages from neutral span text", async () => {
        const file = write("A [one]{.verse lang=en} and *bad*.\n\n[xxx]: https://example.com\n");
        expect(
            (await lint(false, { MD053: true })).results
                .filter((error: any) => error.ruleNames.includes("MD053"))
                .map((error: any) => error.lineNumber),
        ).toEqual([3]);
        expect((await lint(true, { MD053: true })).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe("A [one]{.verse lang=en} and _bad_.\n\n");
    });

    it("counts reference links inside a quoted inline verse span", async () => {
        const quote = "> [A [caption][used]/..line]{.verse lang=en}\r\n";
        const file = write(
            `${quote}\r\n[used]: https://example.com\r\n[unused]: https://example.com\r\n`,
        );
        expect(
            (await lint(false, { MD053: true })).results.map((error: any) => error.lineNumber),
        ).toEqual([4]);
        expect((await lint(true, { MD053: true })).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(`${quote}\r\n[used]: https://example.com\r\n`);
    });

    it("counts ordinary caret-prefixed labels and references in rendered canto titles", async () => {
        write(
            '::: {.verse lang=en}\nFirst line\n\n--- {.canto title="[Watch][canto][^title-note]"}\n[A phrase][^two words]\n:::\n\n[canto]: https://example.com\n[^two words]: https://example.com\n[unused]: https://example.com\n[^title-note]: A note on the title.\n',
        );
        expect(
            (await lint(false, { MD053: true })).results.map((error: any) => error.lineNumber),
        ).toEqual([10]);
    });

    it.each(["::: {.verse lang=en}", ":::verse {lang=en}"])(
        "masks body syntax in %s while retaining surrounding findings",
        async (opening) => {
            write(`Before *bad*.\n\n${opening}\n*WORD*/\n[…][ x ]\n:::\n\nAfter *bad*.\n`);
            const result = await lint();
            expect(result.markup).toEqual([]);
            expect(
                result.results.map((error: any) => [error.lineNumber, error.ruleNames[0]]),
            ).toEqual([
                [1, "MD049"],
                [1, "MD049"],
                [8, "MD049"],
                [8, "MD049"],
            ]);
        },
    );

    it.each(["", "> ", "> > ", "  "])(
        "retains coordinates after verse with container prefix %j and CRLF",
        async (prefix) => {
            const lead = prefix === "  " ? "- item\r\n\r\n" : "";
            write(
                `${lead}${prefix}::: {.verse lang=en}\r\n${prefix}*WORD*/\r\n${prefix}[…][ x ]\r\n${prefix}:::\r\n\r\nAfter *bad*.\r\n`,
            );
            const result = await lint();
            expect(
                result.results.map((error: any) => [error.lineNumber, error.errorRange]),
            ).toEqual([
                [lead ? 8 : 6, [7, 1]],
                [lead ? 8 : 6, [11, 1]],
            ]);
        },
    );

    it("protects inline and multiline verse while fixing prose on the same lines", async () => {
        const quote = "[*WORD*/[…][ x ]]{.verse lang=en}";
        const multiline = "[*FIRST*/\r\n*SECOND*/]{.verse lang=en}";
        const file = write(`Before *bad* ${quote} after *bad*.\r\n\r\n${multiline} and *bad*.\r\n`);
        expect((await lint(true)).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(
            `Before _bad_ ${quote} after _bad_.\r\n\r\n${multiline} and _bad_.\r\n`,
        );
    });

    it("never writes mask bytes or normalizes protected mixed line endings during fixes", async () => {
        const verse = "::: {.verse lang=en}\r\n*WORD*/\r\n\r\n[…][ x ]\r\n:::\r\n";
        const file = write(`Before *bad*.\n\n${verse}\nAfter *bad*.\n`);
        expect((await lint(true)).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(`Before _bad_.\n\n${verse}\nAfter _bad_.\n`);
    });

    it("retains findings and repairs on div opening and closing lines", async () => {
        const file = write("::: {.verse lang=en}  \n*WORD*/\n:::  \n");
        const result = await lint(false, { MD009: { strict: true } });
        expect(result.results.map((error: any) => error.lineNumber)).toEqual([1, 3]);
        await lint(true, { MD009: { strict: true } });
        expect(fs.readFileSync(file, "utf8")).toContain("\n*WORD*/\n:::\n");
    });

    it("does not execute lint directives written inside verse", async () => {
        write(
            "::: {.verse lang=en}\n<!-- markdownlint-disable -->\n*WORD*/\n:::\n\nAfter *bad*.\n",
        );
        expect((await lint()).results.map((error: any) => error.lineNumber)).toEqual([6, 6]);
    });

    it("preserves quote prefixes around multiline inline quotations", async () => {
        const quote = "> [*FIRST*/\r\n> *SECOND*/]{.verse lang=en}";
        const file = write(`${quote} and *bad*.\r\n`);
        expect((await lint(true)).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(`${quote} and _bad_.\r\n`);
    });

    it("masks quotations in table cells even when the table parser removes pipe escapes", async () => {
        const quote = "[*WORD*\\|<!-- markdownlint-disable -->]{.verse lang=en}";
        const file = write(
            `| Verse | Prose |\n| --- | --- |\n| ${quote} | *bad* |\n\nAfter *bad*.\n`,
        );
        expect((await lint(true)).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(
            `| Verse | Prose |\n| --- | --- |\n| ${quote} | _bad_ |\n\nAfter _bad_.\n`,
        );
    });

    it("does not report blank-line or line-length rules inside a verse body", async () => {
        const verse =
            "::: {.verse lang=en}\nA long verse line that exceeds the prose limit/\n\n\n\nAnother line\n:::\n";
        const file = write(verse);
        expect((await lint(true, { MD012: true, MD013: { line_length: 30 } })).results).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(verse);
    });

    it("retains a prose finding but refuses a custom fix that would delete adjacent verse", async () => {
        const source = "Before [A line/]{.verse lang=en} after.\n";
        const file = write(source);
        const result = await runMarkdownlint({
            directory: root,
            globs: ["*.md"],
            defaults: {
                config: { default: false, X001: true },
                customRules: [
                    {
                        names: ["X001", "unsafe-verse-fix"],
                        description: "A custom whole-line deletion",
                        tags: ["test"],
                        function: (_params: any, onError: any) =>
                            onError({
                                lineNumber: 1,
                                range: [1, 6],
                                fixInfo: { deleteCount: -1 },
                            }),
                    },
                ],
            },
            fix: true,
        });
        expect(result.results).toHaveLength(1);
        expect(result.results[0]).not.toHaveProperty("fixInfo");
        expect(fs.readFileSync(file, "utf8")).toBe(source);
    });

    it("retains linting for unclosed divs and malformed spans", async () => {
        write("::: {.verse lang=en}\n*WORD*/\n");
        expect((await lint()).results.map((error: any) => error.lineNumber)).toEqual([2, 2]);
        write("Before [*WORD*/]{.verse\n");
        expect((await lint()).results.length).toBeGreaterThan(0);
    });

    it("leaves literal code examples alone and does not mistake frontmatter for verse", async () => {
        write(
            "---\nexample: |\n  ::: {.verse}\n  *YAML*/\n  :::\n---\n\n```text\n::: {.verse}\n*CODE*/\n:::\n```\n\nAfter *bad*.\n",
        );
        expect((await lint()).results.map((error: any) => error.lineNumber)).toEqual([14, 14]);
    });
});
