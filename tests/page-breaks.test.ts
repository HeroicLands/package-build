/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { renderPreview } from "../engine/site-preview.mjs";
import { markupFindings } from "../engine/markup-validation.mjs";
import { previewIndexFor, PARITY_FIXTURE } from "./helpers/parity.js";

const marker = "--- {.page-break}";
const passage = `Before.\n\n${marker}\n\nAfter.`;
const placement = "a page break stands between blocks at the top level of a note";

describe("authored page breaks", () => {
    it.each(["foundry", "web", "preview"] as const)("omits the marker on %s", (target) => {
        expect(createRenderer(target).render(passage)).toBe("<p>Before.</p>\n<p>After.</p>\n");
    });

    it("emits one weak book page break without a rule", () => {
        const typst = markdownToTypst(passage);
        expect(typst).toContain("Before.\n\n#pagebreak(weak: true)\n\nAfter.");
        expect(typst.match(/#pagebreak/g)).toHaveLength(1);
        expect(typst).not.toMatch(/#line|page-break/);
        expect(
            createRenderer("book")
                .md.parse(passage, {})
                .map((token: any) => token.type),
        ).toEqual([
            "paragraph_open",
            "inline",
            "paragraph_close",
            "page_break",
            "paragraph_open",
            "inline",
            "paragraph_close",
        ]);
    });

    it.each(["\n", "\r\n"])(
        "preserves positions and supports page-edge markers with %j line endings",
        (newline) => {
            const valid = [marker, "", "Passage.", "", marker].join(newline);
            expect(markdownToTypst(valid).match(/#pagebreak\(weak: true\)/g)).toHaveLength(2);
            const source = ["---", "name: Preview", "---", "", "--- {.page-break #extra}"].join(
                newline,
            );
            expect(markupFindings(source, "note.md")).toEqual([
                {
                    file: "note.md",
                    severity: "error",
                    line: 5,
                    column: 5,
                    message: "a page break does not accept an id",
                },
            ]);
        },
    );

    it("does not turn a page break after a div into part of the div", () => {
        const source = `::: {.wide}\nA boxed passage.\n:::\n\n${marker}\n\nAn ordinary passage.`;
        expect(markdownToTypst(source)).toMatch(
            /\]\s*#pagebreak\(weak: true\)\s*An ordinary passage\./,
        );
    });

    it("preserves an indented code example inside a list", () => {
        const source = `- item\n\n      ${marker}`;
        expect(markupFindings(source, "note.md")).toEqual([]);
        expect(markdownToTypst(source)).not.toContain("#pagebreak");
    });

    it.each(["---", "***", "___"])("keeps plain %s as a rule on every target", (rule) => {
        for (const target of ["foundry", "web", "preview"] as const)
            expect(createRenderer(target).render(`Before.\n\n${rule}\n\nAfter.`)).toContain("<hr>");
        expect(markdownToTypst(`Before.\n\n${rule}\n\nAfter.`)).toContain("#line(");
    });

    it.each(["```text\n", "~~~text\n", "::: {.verse}\n"])(
        "keeps a marker literal inside %j",
        (opening) => {
            const close = opening.startsWith(":::") ? ":::" : opening.slice(0, 3);
            const body = `${opening}${marker}\n${close}`;
            expect(markupFindings(body, "note.md")).toEqual([]);
            for (const target of ["foundry", "web", "preview"] as const)
                expect(createRenderer(target).render(body)).toContain("page-break");
            const typst = markdownToTypst(body);
            expect(typst).toContain("page-break");
            expect(typst).not.toContain("#pagebreak");
        },
    );

    it.each([
        ["--- {.other}", 1, 5, "only .page-break"],
        ["--- {.page-break .other}", 1, 5, "only .page-break"],
        ["--- {.page-break #extra}", 1, 5, "does not accept an id"],
        ["--- {.page-break title=extra}", 1, 5, "does not accept attributes"],
        ["*** {.page-break}", 1, 1, "only ---"],
        ["___ {.page-break}", 1, 1, "only ---"],
        ["- --- {.page-break}", 1, 3, placement],
        ["1. --- {.page-break}", 1, 4, placement],
        ["> --- {.page-break}", 1, 3, placement],
        ["> [!NOTE]\n>\n> --- {.page-break}", 3, 3, placement],
        [":::secret\n\n--- {.page-break}\n\n:::", 3, 1, placement],
        ["::: {.wide}\n\n--- {.page-break}\n\n:::", 3, 1, placement],
        ["- item\n\n  --- {.page-break}", 3, 3, placement],
        ["> quote\n--- {.page-break}", 2, 1, placement],
        ["Before.\n--- {.page-break}\n\nAfter.", 2, 1, placement],
    ] as const)("locates an invalid marker in %j", (body, line, column, message) => {
        const findings = markupFindings(body, "note.md").filter((finding: any) =>
            finding.message.includes(message),
        );
        expect(findings).toEqual([
            {
                file: "note.md",
                severity: "error",
                line,
                column,
                message: expect.stringContaining(message),
            },
        ]);
        const bookFindings: any[] = [];
        expect(markdownToTypst(body, { findings: bookFindings })).not.toContain("#pagebreak");
        expect(bookFindings).toContainEqual({
            severity: "error",
            line,
            column,
            message: expect.stringContaining(message),
        });
    });

    it.each([undefined, previewIndexFor(PARITY_FIXTURE)])(
        "reports authored positions in either preview",
        (index) => {
            const source = "---\nname: Preview\n---\n\n> --- {.page-break}";
            const preview = renderPreview(source, { index, infobox: false, file: "note.md" });
            expect(preview.ok).toBe(false);
            expect(preview.findings).toContainEqual({
                file: "note.md",
                severity: "error",
                line: 5,
                column: 3,
                message: placement,
            });
            expect(renderPreview(passage, { index, infobox: false }).html).not.toContain(
                "page-break",
            );
        },
    );
});
